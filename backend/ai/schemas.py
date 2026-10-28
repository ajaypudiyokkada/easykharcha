"""Server-side validation for every shape the model can hand back — see provider/base.py's
run_with_fallback. Nothing from a model response reaches a view or the database unvalidated. Also
caps sizes and strips control characters, per Step C1's "never trust model output" rule."""

import re
from typing import Literal

from pydantic import AliasChoices, BaseModel, Field, field_validator

from .matching import normalise

MAX_DISHES_PER_SCAN = 400
MAX_NAME_LENGTH = 80
MAX_PORTION_LABEL_LENGTH = 40
MAX_INGREDIENTS_PER_DISH = 7
MAX_MINOR_INGREDIENTS_PER_DISH = 8
MAX_VARIANTS_PER_DISH = 6
MAX_NOTE_LENGTH = 20
_ALLOWED_NOTES = {"has options", "two names", "check this"}

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# A variant must be an option/alternate NAME, never a price — this is a backstop for prompt drift
# (e.g. "Chicken Lollipop / Drums of Heaven" miscast as variants ["300", "320"]).
_PRICE_LIKE_VARIANT = re.compile(
    r"^(?:(?P<marker>[₹$]|rs\.?|inr)\s*)?(?P<number>\d[\d,]*\.?\d*)\s*$", re.IGNORECASE
)
# A bare number (no ₹/Rs/INR marker) below this is treated as a dish-style suffix, not a price —
# e.g. "Gobi Manchurian/65" is two dishes, Gobi Manchurian and Gobi 65, not a price of 65.
_BARE_PRICE_FLOOR = 100


def _clean_text(value: str, max_length: int) -> str:
    return _CONTROL_CHARS.sub("", value).strip()[:max_length]


def _clamp_unit(value: float) -> float:
    return max(0.0, min(1.0, value))


def _is_price_like(value: str) -> bool:
    match = _PRICE_LIKE_VARIANT.match(value)
    if not match:
        return False
    if match.group("marker"):
        return True
    try:
        number = float(match.group("number").replace(",", ""))
    except ValueError:
        return False
    return number >= _BARE_PRICE_FLOOR


class ExtractedDish(BaseModel):
    name: str
    price: float | None = None
    confidence: float = 0.5
    kind: Literal["dish", "addon"] = "dish"
    note: str = ""
    variants: list[str] = Field(default_factory=list)
    # Step EK-2: which side of each variant the dish's own printed name/heading sits on when
    # building the real combined dish name — "prefix" (default): name + " " + variant, e.g.
    # "Chicken" + "Manchurian" -> "Chicken Manchurian". "suffix": variant + " " + name, e.g. a
    # "MANCHURIAN" heading with choices "Gobi"/"Paneer" listed as/below it -> "Gobi Manchurian".
    variant_position: Literal["prefix", "suffix"] = "prefix"
    # Only set when variants carry genuinely different prices (e.g. a Veg/Non-veg soup with two
    # price columns) — same length and order as variants; None means every variant shares `price`.
    variant_prices: list[float] | None = None

    @field_validator("name")
    @classmethod
    def _clean_name(cls, value: str) -> str:
        return _clean_text(value, MAX_NAME_LENGTH)

    @field_validator("confidence")
    @classmethod
    def _clamp_confidence(cls, value: float) -> float:
        return _clamp_unit(value)

    @field_validator("price")
    @classmethod
    def _non_negative_price(cls, value: float | None) -> float | None:
        return None if value is None or value < 0 else value

    @field_validator("note")
    @classmethod
    def _clean_note(cls, value: str) -> str:
        cleaned = _clean_text(value, MAX_NOTE_LENGTH)
        return cleaned if cleaned in _ALLOWED_NOTES else ""

    @field_validator("variants")
    @classmethod
    def _clean_variants(cls, value: list[str]) -> list[str]:
        cleaned = [_clean_text(v, MAX_NAME_LENGTH) for v in value]
        return [v for v in cleaned if v and not _is_price_like(v)][:MAX_VARIANTS_PER_DISH]

    @field_validator("variant_prices")
    @classmethod
    def _clean_variant_prices(cls, value: list[float] | None) -> list[float] | None:
        if not value:
            return None
        return [p for p in value[:MAX_VARIANTS_PER_DISH] if p is not None and p >= 0] or None


class ExtractedSection(BaseModel):
    name: str = "Menu"
    dishes: list[ExtractedDish] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def _clean_section_name(cls, value: str) -> str:
        cleaned = _clean_text(value, MAX_NAME_LENGTH)
        return cleaned or "Menu"


class MenuExtractionResult(BaseModel):
    is_menu: bool
    sections: list[ExtractedSection] = Field(default_factory=list)

    def sanitized(self) -> dict:
        """Drops unnamed dishes and caps the total at MAX_DISHES_PER_SCAN, dropping whatever section
        structure is left over once empty — a repair step, not a rejection, since a menu that's
        mostly fine shouldn't be thrown away for one bad row."""
        if not self.is_menu:
            return {"is_menu": False, "sections": []}

        kept_sections = []
        total = 0
        for section in self.sections:
            kept_dishes = []
            for dish in section.dishes:
                if not dish.name or total >= MAX_DISHES_PER_SCAN:
                    continue
                kept_dishes.append(dish.model_dump())
                total += 1
            if kept_dishes:
                kept_sections.append({"name": section.name, "dishes": kept_dishes})
            if total >= MAX_DISHES_PER_SCAN:
                break
        return {"is_menu": True, "sections": kept_sections}


def merge_menu_results(chunk_results: list[dict]) -> tuple[dict, bool]:
    """Combines one sanitized() dict per PDF page-chunk (or just one, for an image scan) into a
    single result, de-duplicating dishes by normalised name across chunks (the same dish can appear
    on more than one page) and re-applying MAX_DISHES_PER_SCAN across the combined total. Returns
    (merged_result, hit_cap) — hit_cap is True when dishes were dropped for the cap, which ai/jobs.py
    turns into the scan's incomplete flag so a long menu is never silently cut short."""
    sections_by_name: dict[str, dict] = {}
    order: list[str] = []
    seen_names: set[str] = set()
    total = 0
    hit_cap = False
    is_menu = False

    for result in chunk_results:
        if not result.get("is_menu"):
            continue
        is_menu = True
        for section in result.get("sections", []):
            name = section["name"]
            if name not in sections_by_name:
                sections_by_name[name] = {"name": name, "dishes": []}
                order.append(name)
            for dish in section["dishes"]:
                key = normalise(dish["name"])
                if key in seen_names:
                    continue
                if total >= MAX_DISHES_PER_SCAN:
                    hit_cap = True
                    break
                seen_names.add(key)
                sections_by_name[name]["dishes"].append(dish)
                total += 1
            if total >= MAX_DISHES_PER_SCAN:
                break
        if total >= MAX_DISHES_PER_SCAN:
            break

    kept_sections = [sections_by_name[name] for name in order if sections_by_name[name]["dishes"]]
    return {"is_menu": is_menu, "sections": kept_sections}, hit_cap


MAX_GROUPS_PER_SCAN = 40
MAX_DISHES_PER_GROUP = 16


class GroupDish(BaseModel):
    """Step EK-2c: one of a group's own final, already-combined dish names (e.g. "Chicken
    Manchurian") — the model builds the real name itself instead of handing back a prefix/suffix
    label for base_discovery to recombine, which was proving unreliable (wrong word order)."""

    name: str
    price: float | None = None

    @field_validator("name")
    @classmethod
    def _clean_name(cls, value: str) -> str:
        return _clean_text(value, MAX_NAME_LENGTH)

    @field_validator("price")
    @classmethod
    def _non_negative_price(cls, value: float | None) -> float | None:
        return None if value is None or value < 0 else value


class ExtractedGroup(BaseModel):
    """Step EK-2b/EK-2c: one heading-plus-choices group found by the dedicated group pass
    (prompts.GROUP_SYSTEM_PROMPT). `heading` is kept only for traceability (expanded_from, and so
    base_discovery.apply_groups can tell when the first pass already expanded this same heading
    itself) — the real output is `dishes`, the group's own final combined names."""

    heading: str
    dishes: list[GroupDish] = Field(default_factory=list)

    @field_validator("heading")
    @classmethod
    def _clean_heading(cls, value: str) -> str:
        return _clean_text(value, MAX_NAME_LENGTH)

    @field_validator("dishes")
    @classmethod
    def _cap_dishes(cls, value: list) -> list:
        return value[:MAX_DISHES_PER_GROUP]


class GroupExtractionResult(BaseModel):
    groups: list[ExtractedGroup] = Field(default_factory=list)

    def sanitized(self) -> dict:
        kept = []
        for group in self.groups:
            named_dishes = [d.model_dump() for d in group.dishes if d.name]
            if not group.heading or len(named_dishes) < 2 or len(kept) >= MAX_GROUPS_PER_SCAN:
                continue
            kept.append({"heading": group.heading, "dishes": named_dishes})
        return {"groups": kept}


def merge_group_results(chunk_results: list[dict]) -> list[dict]:
    """Combines one sanitized() groups dict per chunk into one de-duplicated list, by normalised
    heading — the same group can be found again in a neighbouring page-chunk's overlap."""
    by_heading: dict[str, dict] = {}
    for result in chunk_results:
        for group in result.get("groups", []):
            key = normalise(group["heading"])
            if key not in by_heading:
                by_heading[key] = group
    return list(by_heading.values())


class IngredientSuggestion(BaseModel):
    name: str
    amount: float
    unit: Literal["g", "ml", "pieces"]
    role: Literal["main", "auxiliary"] = "main"
    confidence: float = 0.5
    matched_stock_name: str | None = None

    @field_validator("name")
    @classmethod
    def _clean_name(cls, value: str) -> str:
        return _clean_text(value, MAX_NAME_LENGTH)

    @field_validator("matched_stock_name")
    @classmethod
    def _clean_matched_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = _clean_text(value, MAX_NAME_LENGTH)
        return cleaned or None

    @field_validator("confidence")
    @classmethod
    def _clamp_confidence(cls, value: float) -> float:
        return _clamp_unit(value)

    @field_validator("amount")
    @classmethod
    def _non_negative_amount(cls, value: float) -> float:
        if value < 0:
            raise ValueError("amount must not be negative")
        return value


class DishRecipeSuggestion(BaseModel):
    # Haiku occasionally names this field "name" instead of "dish_name" despite the tool schema —
    # accepting both avoids tripping run_with_fallback's (expensive) fallback-model retry for what
    # is otherwise a perfectly usable response.
    dish_name: str = Field(validation_alias=AliasChoices("dish_name", "name"))
    portion_label: str = ""
    ingredients: list[IngredientSuggestion] = Field(default_factory=list)
    minor_ingredients: list[IngredientSuggestion] = Field(default_factory=list)

    @field_validator("dish_name")
    @classmethod
    def _clean_dish_name(cls, value: str) -> str:
        return _clean_text(value, MAX_NAME_LENGTH)

    @field_validator("portion_label")
    @classmethod
    def _clean_portion_label(cls, value: str) -> str:
        return _clean_text(value, MAX_PORTION_LABEL_LENGTH)

    @field_validator("ingredients")
    @classmethod
    def _cap_ingredients(cls, value: list) -> list:
        return value[:MAX_INGREDIENTS_PER_DISH]

    @field_validator("minor_ingredients")
    @classmethod
    def _cap_minor_ingredients(cls, value: list) -> list:
        return value[:MAX_MINOR_INGREDIENTS_PER_DISH]


class RecipeSuggestionsResult(BaseModel):
    dishes: list[DishRecipeSuggestion] = Field(default_factory=list)


MAX_DISHES_PER_CLASSIFY_CALL = 80
MAX_FAMILY_LENGTH = 40
MAX_REASON_LENGTH = 120


class DishClassification(BaseModel):
    """Step EK-2: the model's ONLY job in base discovery now — pick a type (validated against the
    sector's taxonomy by classification.py, not here, since the taxonomy is sector-agnostic and
    loaded from JSON rather than hardcoded) and a short family/style tag (e.g. "manchurian",
    "mutton", "paratha"). Everything downstream (which base, how many grams/ml per portion) is
    looked up deterministically from backend/ai/knowledge/<sector>.json's type_rules — never
    invented by the model."""

    name: str
    type: str
    family: str = ""
    confidence: float = 0.5
    # Only meaningful when the model deliberately moved a dish away from its most obvious type —
    # kept for a future review screen, never required.
    reason: str = ""

    @field_validator("name")
    @classmethod
    def _clean_name(cls, value: str) -> str:
        return _clean_text(value, MAX_NAME_LENGTH)

    @field_validator("type")
    @classmethod
    def _clean_type(cls, value: str) -> str:
        return _clean_text(value, MAX_NAME_LENGTH)

    @field_validator("family")
    @classmethod
    def _clean_family(cls, value: str) -> str:
        return _clean_text(value, MAX_FAMILY_LENGTH).lower()

    @field_validator("reason")
    @classmethod
    def _clean_reason(cls, value: str) -> str:
        return _clean_text(value, MAX_REASON_LENGTH)

    @field_validator("confidence")
    @classmethod
    def _clamp_confidence(cls, value: float) -> float:
        return _clamp_unit(value)


class DishClassificationResult(BaseModel):
    dishes: list[DishClassification] = Field(default_factory=list)

    @field_validator("dishes")
    @classmethod
    def _cap_dishes(cls, value: list) -> list:
        return value[:MAX_DISHES_PER_CLASSIFY_CALL]
