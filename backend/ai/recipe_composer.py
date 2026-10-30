"""Step EK-3: after the menu is read and bases are found (base_discovery.discover_bases), this
proposes (1) which dishes to set up first, (2) one recipe per dish FAMILY (dishes that share a
recipe shape, e.g. "all Manchurian-style starters"), and (3) the ingredient list those recipes and
bases need, matched to the owner's existing stock items or proposed as new. Backend only — nothing
here writes to StockItem/SellItem/Recipe, see suggest_setup's docstring. All AI output passes through
schemas.py validation and this module's own sanity rules before being trusted; nothing is invented
that wasn't in the dish list or a sector's own knowledge library."""

import hashlib
import re
from decimal import Decimal

from django.conf import settings

from . import limits
from .base_discovery import discover_bases
from .classification import classify_dishes
from .exceptions import AiDailyLimitReached, AiUnavailable
from .knowledge import load_library
from .matching import match_stock_item, normalise, stock_items_by_normalised_name, unit_family
from .models import AiFamilyRecipeCache, AiUsageKind
from .prompts import FAMILY_RECIPE_PROMPT_VERSION
from .provider import compose_family_recipe as provider_compose_family_recipe
from .provider import merge_ingredients as provider_merge_ingredients
from .provider import pick_best_sellers as provider_pick_best_sellers

# Step EK-3b Fix B: raised from 25 — a family-recipe call costs about Rs 0.2, so the real limit is
# how many genuinely distinct recipe shapes a menu has, not AI spend. _merge_small_families still
# merges same-type families first whenever the cap is actually hit.
MAX_FAMILIES_PER_MENU = 60
MIN_BEST_SELLERS = 8
MAX_BEST_SELLERS = 12
MIN_BEST_SELLER_CATEGORIES = 4

# A dish's classify_dishes `type` (ai/knowledge/dish_types.json) rolled up into the coarser grouping
# the best-seller picker and the family composer both show the owner — every type not listed here
# (or an empty/unknown one) falls back to "other".
_CATEGORY_BY_TYPE = {
    "fried_starter_tossed": "starter",
    "fried_starter_dry": "starter",
    "plain_fried_snack": "starter",
    "dry_masala_fry": "starter",
    "grilled_tandoori": "starter",
    "veg_starter_snack": "starter",
    "soup": "starter",
    "salad": "starter",
    "gravy_nonveg": "main",
    "gravy_veg": "main",
    "gravy_makhani": "main",
    "gravy_chinese": "main",
    "gravy_thai": "main",
    "butter_garlic": "main",
    "dal": "main",
    "rice_plain": "rice_bread",
    "rice_fried": "rice_bread",
    "noodles": "rice_bread",
    "bread_dough": "rice_bread",
    "bread_maida": "rice_bread",
    "beverage": "drink",
    "dessert": "dessert",
}

# Step EK-3b Fix C: these ranges are deliberately generous — a real whole-item portion (a whole
# tandoori chicken, a big thali rice mound) can legitimately be large; the point is only to catch a
# genuinely broken number (e.g. 50,000 g), never a real-but-big one (e.g. 1,000 g).
_MIN_QTY_BY_UNIT = {"g": 5.0, "ml": 5.0, "pieces": 1.0}
_MAX_QTY_BY_UNIT = {"g": 1500.0, "ml": 1000.0, "pieces": 20.0}
_DEFAULT_QTY_BY_UNIT = {"g": 150.0, "ml": 150.0, "pieces": 1.0}

# Step EK-3b Fix A: a dish named with one of these must never get a meat/fish/prawn main item, and
# the other way round — a mismatch (whichever side the model got wrong) is dropped, never trusted.
_VEG_MARKERS = {"veg", "egg", "paneer", "gobi", "mushroom"}
_PROTEIN_MARKERS = {"chicken", "fish", "pork", "mutton", "prawn"}


def _has_marker(text: str, markers: set[str]) -> bool:
    norm = normalise(text)
    return any(re.search(rf"\b{re.escape(m)}\b", norm) for m in markers)


def _main_item_mismatch(dish_name: str, main_item_name: str) -> bool:
    if not main_item_name:
        return False
    dish_is_veg = _has_marker(dish_name, _VEG_MARKERS)
    dish_is_protein = _has_marker(dish_name, _PROTEIN_MARKERS)
    item_is_veg = _has_marker(main_item_name, _VEG_MARKERS)
    item_is_protein = _has_marker(main_item_name, _PROTEIN_MARKERS)
    return (dish_is_veg and item_is_protein) or (dish_is_protein and item_is_veg)


# Prep-descriptor words stripped before merging two ingredient names as "the same thing" (Onion vs
# Onion Chopped) — never strips a word that changes what the ingredient actually is.
_DESCRIPTOR_WORDS = {
    "chopped",
    "sliced",
    "diced",
    "minced",
    "crushed",
    "grated",
    "julienned",
    "cubed",
    "fresh",
    "whole",
    "ground",
    "paste",
}

# Step EK-3b Fix E: a short, reviewed, whole-word keyword table (not substring matching — "cabbage"
# must never match "bag", see _keyword_hit below) across four categories. Step EK-3c: _guess_low_
# stock_category now checks dry_staples BEFORE perishable/fresh_semi (packaging still checked first
# of all) — a processed/dried form (coconut OIL, tomato SAUCE, coriander POWDER, bread CRUMBS) must
# win over the fresh ingredient it's made from, which the old perishable/fresh_semi-first order got
# backwards (real-run bug: coconut oil and tomato sauce both came out fresh_semi).
_PERISHABLE_KEYWORDS = {
    "meat",
    "chicken",
    "mutton",
    "pork",
    "bacon",
    "sausage",
    "sausages",
    "fish",
    "prawn",
    "egg",
    "milk",
    "curd",
    "yogurt",
    "paneer",
    "cream",
    "butter",
    "ginger",
    "garlic",
    "bread",
    "coriander",
    "mint",
    "lettuce",
    "capsicum",
    "gobi",
    "mushroom",
    "lemon",
    "curry leaves",
    "spinach",
    "babycorn",
    "baby corn",
    "broccoli",
    "cucumber",
    "banana",
    "watermelon",
    "water melon",
    "pineapple",
    "fruit",
    "chilli",
    "peas",
    "corn",
    "vegetable",
    "vegetables",
}
_FRESH_SEMI_KEYWORDS = {"carrot", "cabbage", "onion", "potato", "coconut", "tomato"}
_DRY_STAPLE_KEYWORDS = {
    "rice",
    "atta",
    "maida",
    "cornflour",
    "sugar",
    "salt",
    "oil",
    "vinegar",
    "sauce",
    "spice",
    "masala",
    "flour",
    "lentil",
    "dal",
    "besan",
    "sooji",
    "tea",
    "coffee",
    "powder",
    "extract",
    "essence",
    "crumbs",
    "ketchup",
}
_PACKAGING_KEYWORDS = {"box", "bag", "napkin", "foil", "container", "cleaning", "tissue", "wrap"}


def _keyword_hit(norm: str, keywords: set[str]) -> bool:
    """Whole-word match only — Fix E's real bug was substring matching (e.g. "cabbage" matching the
    packaging keyword "bag" mid-word, "ginger"/"garlic"/"carrot" never being in any perishable/fresh
    list at all and silently falling through to dry_staples)."""
    return any(re.search(rf"\b{re.escape(kw)}\b", norm) for kw in keywords)


def category_for_type(dish_type: str) -> str:
    return _CATEGORY_BY_TYPE.get(dish_type, "other")


def _keyword_score(name_norm: str, keywords: list[str]) -> int:
    return sum(1 for kw in keywords if kw in name_norm)


def _shortlist(dishes: list[dict], classifications: dict[str, dict], library: dict) -> list[dict]:
    """Library-keyword-ranked candidates, grouped by category, used to build the one small AI call's
    input — never the whole menu, to keep that call cheap."""
    keywords = library.get("popular_keywords", [])
    by_category: dict[str, list[tuple[int, dict]]] = {}
    for dish in dishes:
        info = classifications.get(normalise(dish["name"]), {})
        category = category_for_type(info.get("type", ""))
        score = _keyword_score(normalise(dish["name"]), keywords) * 10 + int(
            info.get("confidence", 0) * 10
        )
        by_category.setdefault(category, []).append((score, dish))

    shortlist = []
    for category, scored in by_category.items():
        scored.sort(key=lambda pair: -pair[0])
        for _score, dish in scored[:8]:
            shortlist.append({"name": dish["name"], "category": category})
    return shortlist


def pick_best_sellers(
    dishes: list[dict],
    classifications: dict[str, dict],
    sector: str,
    business=None,
    *,
    pick_fn=None,
) -> dict:
    """Returns {"best_sellers": [{"name", "category", "reason"}], "usage": [...]}. Library-keyword
    scoring builds the shortlist, one AI call narrows it down; any pick the model returns that isn't
    an exact (normalised) match to a real dish in the shortlist is dropped (F: never invent a dish).
    If the survivors don't reach MIN_BEST_SELLERS or MIN_BEST_SELLER_CATEGORIES, the gap is filled
    deterministically from the same ranked shortlist, round-robin by category."""
    library = load_library(sector)
    shortlist = _shortlist(dishes, classifications, library)
    shortlist_by_norm = {normalise(item["name"]): item for item in shortlist}
    usage: list[dict] = []
    picks: list[dict] = []
    seen: set[str] = set()

    can_call_ai = bool(shortlist) and (business is None or not limits.monthly_cost_cap_exceeded())
    if can_call_ai:
        pick = pick_fn or provider_pick_best_sellers
        result = pick(shortlist, sector)
        usage.append(
            {
                "model": result.model,
                "input_tokens": result.input_tokens,
                "output_tokens": result.output_tokens,
                "used_fallback": result.used_fallback,
            }
        )
        if business is not None:
            limits.record_usage(
                business=business,
                kind=AiUsageKind.SETUP_BEST_SELLERS,
                model=result.model,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
            )
        for raw_pick in result.data["picks"]:
            key = normalise(raw_pick["name"])
            if key not in shortlist_by_norm or key in seen:
                continue
            seen.add(key)
            picks.append(
                {
                    "name": shortlist_by_norm[key]["name"],
                    "category": shortlist_by_norm[key]["category"],
                    "reason": raw_pick.get("reason", ""),
                }
            )

    categories_covered = {p["category"] for p in picks}
    if len(picks) < MIN_BEST_SELLERS or len(categories_covered) < MIN_BEST_SELLER_CATEGORIES:
        remaining_by_category: dict[str, list[dict]] = {}
        for item in shortlist:
            if normalise(item["name"]) in seen:
                continue
            remaining_by_category.setdefault(item["category"], []).append(item)
        while len(picks) < MAX_BEST_SELLERS and any(remaining_by_category.values()):
            for category in list(remaining_by_category):
                bucket = remaining_by_category[category]
                if not bucket:
                    del remaining_by_category[category]
                    continue
                item = bucket.pop(0)
                picks.append(
                    {
                        "name": item["name"],
                        "category": item["category"],
                        "reason": "a commonly popular dish",
                    }
                )
                seen.add(normalise(item["name"]))
                if len(picks) >= MAX_BEST_SELLERS:
                    break

    return {"best_sellers": picks[:MAX_BEST_SELLERS], "usage": usage}


def _family_key_for(dish: dict, classification: dict) -> tuple[str, str]:
    """(type, family-or-type) — grouping key for build_families. A dish with no family tag from
    classify_dishes groups by its type alone (e.g. every "rice_fried" dish is one family even with
    no specific style tag)."""
    dish_type = classification.get("type", "other")
    family_tag = classification.get("family") or dish_type
    return dish_type, family_tag


def _family_label(family_tag: str) -> str:
    return f"{family_tag.title()} family"


def build_families(dishes: list[dict], classifications: dict[str, dict]) -> list[dict]:
    """Groups dishes sharing a recipe shape (same classify_dishes family tag, or the same type when
    there's no tag) into families. Returns [{"name", "type", "dishes": [names]}], ordered by family
    size descending (largest families first — the ones most worth the owner's attention)."""
    groups: dict[tuple[str, str], list[str]] = {}
    for dish in dishes:
        info = classifications.get(normalise(dish["name"]), {"type": "other", "family": ""})
        key = _family_key_for(dish, info)
        groups.setdefault(key, []).append(dish["name"])

    families = [
        {"name": _family_label(family_tag), "type": dish_type, "dishes": names}
        for (dish_type, family_tag), names in groups.items()
    ]
    families.sort(key=lambda f: -len(f["dishes"]))
    return families


def _merge_small_families(families: list[dict], cap: int) -> list[dict]:
    """Over the cap: exhausts every possible same-`type` merge FIRST (so every merged "family" still
    shares one real recipe shape), one smallest-pair at a time across the whole list — not just
    relative to whichever family happens to be globally smallest, which could force a premature
    cross-type merge while an unrelated same-type pair elsewhere was still available. Only once no
    two remaining families share a type does it fall back to merging the smallest families overall,
    regardless of type, as a last resort to reach the cap."""
    families = [dict(f) for f in families]

    def _merge_smallest_pair(same_type_only: bool) -> bool:
        families.sort(key=lambda f: len(f["dishes"]))
        for smallest in families:
            match = next(
                (
                    f
                    for f in families
                    if f is not smallest and (not same_type_only or f["type"] == smallest["type"])
                ),
                None,
            )
            if match is not None:
                match["dishes"] = match["dishes"] + smallest["dishes"]
                families.remove(smallest)
                return True
        return False

    while len(families) > cap and _merge_smallest_pair(same_type_only=True):
        pass
    while len(families) > cap and _merge_smallest_pair(same_type_only=False):
        pass

    families.sort(key=lambda f: -len(f["dishes"]))
    return families


def _sanitise_main_item_qty(name: str, unit: str, qty: float) -> tuple[str, float, str | None]:
    """Returns (unit, qty, correction_message_or_None). Fix C: qty<=0 is handled by the caller before
    this is ever called — 0 means "not used", never an error. Only a genuinely implausible NONZERO
    amount for its unit falls back to the library default, and every fallback is reported in
    corrections — never silently. Eggs are always tracked in pieces, whatever unit the model gave."""
    if _has_marker(name, {"egg"}):
        unit = "pieces"
    low = _MIN_QTY_BY_UNIT.get(unit, 0.0)
    high = _MAX_QTY_BY_UNIT.get(unit, float("inf"))
    if low <= qty <= high:
        return unit, qty, None
    default = _DEFAULT_QTY_BY_UNIT.get(unit, qty)
    return (
        unit,
        default,
        f"{name}: {qty:g} {unit} per portion looked wrong, used the default {default:g} instead",
    )


def _base_ingredient_names_for_family(family_dishes: list[str], bases: list[dict]) -> list[str]:
    """Every raw ingredient name already covered by a base used by any dish in this family — the
    family recipe call must not repeat these (F: recipes for dishes using a base must not repeat the
    base's own ingredients)."""
    family_dishes_norm = {normalise(name) for name in family_dishes}
    names: set[str] = set()
    for base in bases:
        used_by_this_family = any(
            normalise(use["dish"]) in family_dishes_norm for use in base["used_by"]
        )
        if used_by_this_family:
            names.update(ing["name"] for ing in base["batch_ingredients"])
    return sorted(names)


def _family_cache_key(sector: str, family_name: str, member_dish_names: list[str]) -> str:
    normalised = sorted({normalise(name) for name in member_dish_names})
    raw = normalise(family_name) + "|" + "|".join(normalised)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def compose_family_recipes(
    families: list[dict],
    bases: list[dict],
    business_type: str,
    stock_items: list[tuple[str, str]],
    business=None,
    *,
    compose_fn=None,
) -> dict:
    """One AI call per family (cached by (sector, family-members-hash) so a repeated family on a
    repeat run never pays twice), returning [{"name", "type", "dishes", "portion_label", "members":
    [{"dish_name", "main_item_name", "main_item_unit", "qty"}, ...], "bases_used": [...],
    "ingredients": [...], "minor_ingredients": [...], "excluded_base_ingredients": [...],
    "corrections": [...], "flags": [...]}]. Fix A: every family dish gets its own members entry — a
    family's "main item" is only a label, each member can use a different one (or none: empty
    main_item_name/0 qty). Caps at MAX_FAMILIES_PER_MENU, merging the smallest families first.
    `bases` is base_discovery.discover_bases's own result — used only to look up each family's
    already-known base-grams-per-portion (deterministic, never asked of the model again) and which
    ingredient names to tell the model not to repeat (and to strip out again afterward, in case the
    model repeats one anyway — Fix D's final pass)."""
    capped = _merge_small_families(families, MAX_FAMILIES_PER_MENU)
    sector = business_type

    if business is not None and capped:
        if limits.monthly_cost_cap_exceeded():
            raise AiUnavailable()
        if not limits.check_daily_setup_limit(business.id, len(capped)):
            raise AiDailyLimitReached()

    compose = compose_fn or provider_compose_family_recipe
    results = []
    usage: list[dict] = []

    base_grams_by_dish_and_base: dict[str, list[dict]] = {}
    for base in bases:
        for use in base["used_by"]:
            base_grams_by_dish_and_base.setdefault(normalise(use["dish"]), []).append(
                {
                    "base": base["name"],
                    "grams_per_portion": use["grams_per_portion"],
                }
            )

    for family in capped:
        excluded = _base_ingredient_names_for_family(family["dishes"], bases)
        excluded_keys = {_merge_key(n) for n in excluded}
        cache_key = _family_cache_key(sector, family["name"], family["dishes"])
        cached = AiFamilyRecipeCache.objects.filter(
            sector=sector, family_hash=cache_key, prompt_version=FAMILY_RECIPE_PROMPT_VERSION
        ).first()
        if cached:
            recipe = cached.result
        else:
            result = compose(family["name"], family["dishes"], business_type, stock_items, excluded)
            usage.append(
                {
                    "model": result.model,
                    "input_tokens": result.input_tokens,
                    "output_tokens": result.output_tokens,
                    "used_fallback": result.used_fallback,
                }
            )
            if business is not None:
                limits.record_usage(
                    business=business,
                    kind=AiUsageKind.SETUP_FAMILY_RECIPE,
                    model=result.model,
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                )
            recipe = result.data
            AiFamilyRecipeCache.objects.update_or_create(
                sector=sector,
                family_hash=cache_key,
                prompt_version=FAMILY_RECIPE_PROMPT_VERSION,
                defaults={"result": recipe},
            )

        corrections: list[str] = []
        flags: list[str] = []
        family_dish_norms = {normalise(d) for d in family["dishes"]}
        seen_members: set[str] = set()
        members = []
        for member in recipe.get("members", []):
            dish_name = member["dish_name"]
            dish_norm = normalise(dish_name)
            if dish_norm not in family_dish_norms or dish_norm in seen_members:
                continue  # never trust a member name the family doesn't actually contain, or a repeat
            seen_members.add(dish_norm)

            main_name = member.get("main_item_name") or ""
            main_unit = member.get("main_item_unit") or "g"
            main_qty = member.get("main_item_qty") or 0.0

            if main_name and main_qty > 0 and _main_item_mismatch(dish_name, main_name):
                flags.append(
                    f'check this: "{dish_name}" was given "{main_name}" as its main item, which '
                    "looks like the wrong veg/non-veg match — dropped"
                )
                main_name, main_qty = "", 0.0

            if not main_name or main_qty <= 0:
                members.append(
                    {"dish_name": dish_name, "main_item_name": "", "main_item_unit": "", "qty": 0.0}
                )
                continue

            fixed_unit, fixed_qty, correction = _sanitise_main_item_qty(
                main_name, main_unit, main_qty
            )
            if correction:
                corrections.append(correction)
            members.append(
                {
                    "dish_name": dish_name,
                    "main_item_name": main_name,
                    "main_item_unit": fixed_unit,
                    "qty": fixed_qty,
                }
            )

        # Fix A: never silently drop a member dish the model's response forgot about — record it as
        # having no main item rather than inventing one.
        for dish_name in family["dishes"]:
            if normalise(dish_name) not in seen_members:
                members.append(
                    {"dish_name": dish_name, "main_item_name": "", "main_item_unit": "", "qty": 0.0}
                )

        bases_used = {}
        for dish_name in family["dishes"]:
            for entry in base_grams_by_dish_and_base.get(normalise(dish_name), []):
                bases_used.setdefault(entry["base"], entry["grams_per_portion"])

        # Fix D: a final deterministic pass — never trust the model to have actually left base-covered
        # ingredients out, even though it was told to.
        ingredients = [
            ing
            for ing in recipe.get("ingredients", [])
            if _merge_key(ing["name"]) not in excluded_keys
        ]
        minor_ingredients = [
            ing
            for ing in recipe.get("minor_ingredients", [])
            if _merge_key(ing["name"]) not in excluded_keys
        ]

        results.append(
            {
                "name": family["name"],
                "type": family["type"],
                "dishes": family["dishes"],
                "portion_label": recipe.get("portion_label", ""),
                "members": members,
                "bases_used": [
                    {"base": name, "grams_per_portion": g} for name, g in bases_used.items()
                ],
                "ingredients": ingredients,
                "minor_ingredients": minor_ingredients,
                "excluded_base_ingredients": excluded,
                "corrections": corrections,
                "flags": flags,
            }
        )

    return {"families": results, "usage": usage}


def _merge_key(name: str) -> str:
    """Onion / Onions / Onion Chopped all collapse to the same key — strips a trailing plural 's'
    (len > 3, so "Peas"/"Oil" aren't mangled) and any prep-descriptor word, then normalises."""
    norm = normalise(name)
    words = [w for w in norm.split() if w not in _DESCRIPTOR_WORDS]
    words = [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in words]
    return " ".join(sorted(words)) or norm


def _guess_low_stock_category(name: str) -> str:
    norm = normalise(name)
    if _keyword_hit(norm, _PACKAGING_KEYWORDS):
        return "packaging_cleaning"
    if _keyword_hit(norm, _DRY_STAPLE_KEYWORDS):
        return "dry_staples"
    if _keyword_hit(norm, _PERISHABLE_KEYWORDS):
        return "perishable"
    if _keyword_hit(norm, _FRESH_SEMI_KEYWORDS):
        return "fresh_semi"
    return "dry_staples"


def _unit_family_guess(unit: str) -> str:
    return unit_family(unit)


# Step EK-3b Fix D: strips a bracketed or comma-trailing descriptor, e.g. "Capsicum (green ...)" or
# "Cabbage, shredded" -> "Capsicum"/"Cabbage".
_BRACKETED = re.compile(r"\s*\([^()]*\)\s*")
_COMMA_DESCRIPTOR = re.compile(r"\s*,.*$")
_COOKED = re.compile(r"\bcooked\b")


def _strip_descriptors(name: str) -> str:
    stripped = _COMMA_DESCRIPTOR.sub("", _BRACKETED.sub(" ", name)).strip()
    return " ".join(stripped.split()) or name


def _is_cooked_derived(name: str) -> bool:
    """A dish/family's own ingredient list sometimes names the COOKED form of something a base
    already produces (e.g. "Cooked basmati rice", "Basmati rice (cooked base)") — that's the base's
    own output, not a raw ingredient to buy, so it's dropped entirely rather than proposed as a new
    stock item. Checked on the raw name, before bracket-stripping, since the giveaway word is
    sometimes only inside the bracket."""
    norm = normalise(name)
    return bool(_COOKED.search(norm)) and "rice" in norm


def _build_alias_lookup(sector: str) -> dict[str, str]:
    """normalised alias phrase -> canonical display name, from the sector's own knowledge library
    (e.g. "capsicum"/"bell pepper"/"green capsicum" all -> "Capsicum"). A sector with no library (or
    no aliases) returns an empty lookup — canonicalisation becomes a no-op, never an error."""
    aliases = load_library(sector).get("ingredient_aliases", {})
    lookup: dict[str, str] = {}
    for canonical, variants in aliases.items():
        for variant in variants:
            lookup[normalise(variant)] = canonical
    return lookup


def _canonical_ingredient_name(name: str, alias_lookup: dict[str, str]) -> str:
    """Fix D: merges near-duplicate ingredient names (capsicum/bell pepper, black pepper variants,
    cumin/jeera, cooking/refined/vegetable oil, case/plural/bracket/comma-descriptor differences) to
    one canonical display name via the sector's alias table — deliberately narrow phrases only in
    the general (substring) lookup, so e.g. "oil" alone never substring-matches inside "Coconut oil"/
    "Mustard oil" and sweeps them in too. A bare "Oil" with nothing else in the name (the real-world
    case: a model naming plain frying oil, not a specialty oil) is the one EXACT-match-only
    exception, checked before the substring pass can ever see it."""
    cleaned = _strip_descriptors(name)
    norm = normalise(cleaned)
    if norm == "oil":
        return "Cooking oil"
    if norm in alias_lookup:
        return alias_lookup[norm]
    for phrase in sorted(alias_lookup, key=len, reverse=True):
        if re.search(rf"\b{re.escape(phrase)}\b", norm):
            return alias_lookup[phrase]
    return cleaned


# Step EK-3c Fix D: never a stock item — Water/Ice are consumed in the kitchen but nobody buys them
# as a tracked ingredient. Checked on the descriptor-stripped, normalised name so "Ice cubes"/"Ice,
# crushed" are caught the same as a bare "Ice" (never confused with "Ice cream", a real stock item —
# the sector's never-merge list keeps the two apart during merging too).
_EXCLUDED_NON_STOCK_ITEMS = {"water", "ice", "ice cubes", "ice cube"}


def _is_excluded_non_stock_item(name: str) -> bool:
    return normalise(_strip_descriptors(name)) in _EXCLUDED_NON_STOCK_ITEMS


def _never_merge_pairs(sector: str) -> list[tuple[str, str]]:
    return [(normalise(a), normalise(b)) for a, b in load_library(sector).get("never_merge", [])]


def _phrase_in(norm: str, phrase: str) -> bool:
    return bool(re.search(rf"\b{re.escape(phrase)}\b", norm))


def _pair_side(norm: str, left: str, right: str) -> str | None:
    """Which side of a never-merge pair this normalised name belongs to — checks the LONGER phrase
    first, since a shorter phrase can be a genuine word inside the longer one without meaning the
    same thing (e.g. "ice" is a real word inside "Vanilla ice cream", which is still an ice-cream
    item, not a conflict with the "ice cream"/"ice" pair — checking "ice cream" first resolves it to
    that side before the shorter "ice" ever gets a chance to wrongly also match)."""
    long_phrase, long_side, short_phrase, short_side = (
        (left, "left", right, "right")
        if len(left) >= len(right)
        else (right, "right", left, "left")
    )
    if _phrase_in(norm, long_phrase):
        return long_side
    if _phrase_in(norm, short_phrase):
        return short_side
    return None


def _never_merge_conflict(
    name_a: str, name_b: str, never_merge_pairs: list[tuple[str, str]]
) -> bool:
    norm_a = normalise(_strip_descriptors(name_a))
    norm_b = normalise(_strip_descriptors(name_b))
    for left, right in never_merge_pairs:
        side_a = _pair_side(norm_a, left, right)
        side_b = _pair_side(norm_b, left, right)
        if side_a and side_b and side_a != side_b:
            return True
    return False


def _group_is_safe(
    member_names: list[str], unit_by_name: dict[str, str], never_merge_pairs: list[tuple[str, str]]
) -> bool:
    """A proposed merge group is trusted only when every member shares one unit family (g/ml/pieces —
    never e.g. a g item merged with a pieces item) and no two members conflict on the sector's
    never-merge list (e.g. "rice flour" and "rice" are never the same purchasable item)."""
    units = {unit_by_name[name] for name in member_names if name in unit_by_name}
    if len({_unit_family_guess(u) for u in units}) > 1:
        return False
    for i, name_a in enumerate(member_names):
        for name_b in member_names[i + 1 :]:
            if _never_merge_conflict(name_a, name_b, never_merge_pairs):
                return False
    return True


def _merge_ingredient_entries(
    raw: dict[str, dict], business, sector: str, *, merge_fn=None
) -> tuple[dict[str, dict], list[dict], list[dict]]:
    """Step EK-3c: one cheap AI call over the already alias-merged entries groups genuine remaining
    near-duplicates (e.g. Gram flour/Besan, Aloo/Potato) into one purchasable item and tags every
    final item with a low-stock category. A proposed group is applied only when _group_is_safe passes
    — an unsafe or partly-unrecognised group is rejected and every one of its members stays its own
    separate entry, still carrying the AI's own category guess (categorisation doesn't depend on the
    merge being trusted). An entry the call never mentions (call skipped or failed) is left completely
    untouched, falling back to the keyword table alone. Returns (new_raw, merges_log, usage) —
    merges_log lists only the merges actually applied, for a step/real-run proof to print."""
    entries = list(raw.items())
    if not entries:
        return raw, [], []

    name_to_key = {entry["display_name"]: key for key, entry in entries}
    unit_by_name = {entry["display_name"]: entry["unit"] for _key, entry in entries}
    never_merge_pairs = _never_merge_pairs(sector)

    can_call_ai = business is None or not limits.monthly_cost_cap_exceeded()
    groups: list[dict] = []
    usage: list[dict] = []
    if can_call_ai:
        merge = merge_fn or provider_merge_ingredients
        items = [
            {"name": entry["display_name"], "unit_family": _unit_family_guess(entry["unit"])}
            for _key, entry in entries
        ]
        result = merge(items)
        usage.append(
            {
                "model": result.model,
                "input_tokens": result.input_tokens,
                "output_tokens": result.output_tokens,
                "used_fallback": result.used_fallback,
            }
        )
        if business is not None:
            limits.record_usage(
                business=business,
                kind=AiUsageKind.SETUP_INGREDIENT_MERGE,
                model=result.model,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
            )
        groups = result.data.get("groups", [])

    new_raw: dict[str, dict] = {}
    merges_log: list[dict] = []
    seen_names: set[str] = set()

    for group in groups:
        # Never trust a member name the resolver doesn't actually have, or a repeat across groups.
        members = [m for m in group.get("members", []) if m in name_to_key and m not in seen_names]
        if not members:
            continue
        category = group.get("category", "dry_staples")
        if len(members) >= 2 and _group_is_safe(members, unit_by_name, never_merge_pairs):
            canonical = group.get("canonical_name") or members[0]
            used_in: set = set()
            for name in members:
                used_in |= raw[name_to_key[name]]["used_in"]
            new_raw[_merge_key(canonical)] = {
                "display_name": canonical,
                "unit": unit_by_name[members[0]],
                "used_in": used_in,
                "ai_category": category,
            }
            merges_log.append({"canonical_name": canonical, "members": members})
        else:
            # Singleton, or an unsafe group split back into its separate original entries — each
            # still gets the AI's own category guess, only the merge itself is distrusted.
            for name in members:
                new_raw[name_to_key[name]] = {**raw[name_to_key[name]], "ai_category": category}
        seen_names.update(members)

    for key, entry in raw.items():
        if entry["display_name"] not in seen_names:
            new_raw[key] = entry

    return new_raw, merges_log, usage


def resolve_ingredients(
    family_results: list[dict], bases: list[dict], business=None, sector: str = "", *, merge_fn=None
) -> dict:
    """Collects every ingredient across the family recipes' per-member main items + shared
    ingredients + minor_ingredients, plus every base's own batch ingredients, canonicalises and
    merges near-duplicate names (Fix D), excludes Water/Ice (never a stock item), runs them through
    one AI merge+categorise call (Step EK-3c, _merge_ingredient_entries), and matches each final
    ingredient to an existing StockItem (fuzzy, business-scoped) or proposes it as new. Returns
    {"matched": [...], "new": [...], "merges": [...], "excluded": [...]}; every matched/new entry
    carries `used_in` (dish/base names)."""
    alias_lookup = _build_alias_lookup(sector)
    raw: dict[str, dict] = {}  # merge key -> {"display_name", "unit", "used_in": set()}
    excluded: set[str] = set()

    def _add(name: str, unit: str, used_in: str) -> None:
        if not name or _is_cooked_derived(name):
            return
        canonical = _canonical_ingredient_name(name, alias_lookup)
        if _is_excluded_non_stock_item(canonical):
            excluded.add(canonical)
            return
        if _has_marker(canonical, {"egg"}):
            unit = "pieces"  # eggs are always tracked in pieces, whatever unit the source gave
        key = _merge_key(canonical)
        entry = raw.setdefault(key, {"display_name": canonical, "unit": unit, "used_in": set()})
        entry["used_in"].add(used_in)
        # Prefer the shorter/cleaner display name once we have a choice between variants.
        if len(canonical) < len(entry["display_name"]):
            entry["display_name"] = canonical

    for family in family_results:
        dish_label = family["name"]
        for member in family["members"]:
            if member["qty"] and member["main_item_name"]:
                _add(member["main_item_name"], member["main_item_unit"], dish_label)
        for ing in family["ingredients"]:
            _add(ing["name"], ing["unit"], dish_label)
        for ing in family["minor_ingredients"]:
            _add(ing["name"], ing["unit"], dish_label)

    for base in bases:
        base_label = f"base: {base['name']}"
        for ing in base["batch_ingredients"]:
            _add(ing["name"], ing["unit"], base_label)

    raw, merges, merge_usage = _merge_ingredient_entries(raw, business, sector, merge_fn=merge_fn)

    stock_by_norm = stock_items_by_normalised_name(business) if business is not None else {}

    matched = []
    new = []
    for entry in raw.values():
        used_in = sorted(entry["used_in"])
        match = match_stock_item(stock_by_norm, entry["display_name"]) if stock_by_norm else None
        if match:
            stock_id, stock_name, stock_unit = match
            matched.append(
                {
                    "stock_item_id": stock_id,
                    "stock_item_name": stock_name,
                    "matched_from": entry["display_name"],
                    "used_in": used_in,
                }
            )
        else:
            # Fix E's keyword table overrides the AI's own category guess for the "obvious" cases
            # (anything it has a specific perishable/fresh_semi/packaging rule for); the AI's guess is
            # used only for the dry_staples catch-all, and only when the call actually ran.
            keyword_guess = _guess_low_stock_category(entry["display_name"])
            category = (
                keyword_guess
                if keyword_guess != "dry_staples"
                else entry.get("ai_category") or keyword_guess
            )
            new.append(
                {
                    "name": entry["display_name"],
                    "unit_family": _unit_family_guess(entry["unit"]),
                    "pack_size": None,
                    "low_stock_category": category,
                    "used_in": used_in,
                }
            )

    matched.sort(key=lambda m: m["stock_item_name"])
    new.sort(key=lambda n: n["name"])
    return {
        "matched": matched,
        "new": new,
        "matched_count": len(matched),
        "new_count": len(new),
        "merges": merges,
        "excluded": sorted(excluded),
        "usage": merge_usage,
    }


def suggest_setup(
    dishes: list[dict],
    sector: str,
    business=None,
    *,
    classify_fn=None,
    pick_fn=None,
    compose_fn=None,
    merge_fn=None,
    menu_scan=None,
) -> dict:
    """The one orchestrator entry point for Step EK-3. `dishes` must already be expanded
    (base_discovery.expand_dish_options + apply_groups), same contract as discover_bases. Returns
    {"best_sellers", "families", "bases", "ingredients", "cost_summary"} and, when `menu_scan` is
    given, also saves it onto menu_scan.result["setup"] so a later step (EK-4) can read it from
    there. Never writes to StockItem/SellItem/Recipe/Base — those only happen once the owner
    confirms, in a later step."""
    # discover_bases does its own daily/monthly limit gating around the (only) real classify call —
    # call it FIRST so classify_dishes below (same dish set) is always a cache hit, never a second
    # ungated call.
    bases_data = discover_bases(dishes, sector, [], business=business, classify_fn=classify_fn)
    bases = bases_data["bases"]
    classifications, classify_usage = classify_dishes(dishes, sector, classify_fn=classify_fn)

    stock_items: list[tuple[str, str]] = []
    if business is not None:
        stock_items = [
            (name, unit_family(unit))
            for _id, name, unit in business.stock_items.filter(active=True).values_list(
                "id", "name", "unit"
            )
        ]

    best_sellers_data = pick_best_sellers(
        dishes, classifications, sector, business, pick_fn=pick_fn
    )
    families = build_families(dishes, classifications)
    family_data = compose_family_recipes(
        families, bases, sector, stock_items, business, compose_fn=compose_fn
    )
    ingredients = resolve_ingredients(
        family_data["families"], bases, business, sector=sector, merge_fn=merge_fn
    )

    all_usage = (
        classify_usage
        + bases_data["usage"]
        + best_sellers_data["usage"]
        + family_data["usage"]
        + ingredients["usage"]
    )
    total_input = sum(u["input_tokens"] for u in all_usage)
    total_output = sum(u["output_tokens"] for u in all_usage)
    est_cost_usd = (
        Decimal(total_input) / Decimal(1_000_000) * settings.AI_PRICE_IN_PER_MTOK
        + Decimal(total_output) / Decimal(1_000_000) * settings.AI_PRICE_OUT_PER_MTOK
    )

    result = {
        "best_sellers": best_sellers_data["best_sellers"],
        "families": family_data["families"],
        "bases": bases,
        "ingredients": ingredients,
        "cost_summary": {
            "calls": len(all_usage),
            "input_tokens": total_input,
            "output_tokens": total_output,
            "est_cost_usd": str(est_cost_usd),
        },
    }

    if menu_scan is not None:
        menu_scan.result = {**(menu_scan.result or {}), "setup": result}
        menu_scan.save(update_fields=["result"])

    return result
