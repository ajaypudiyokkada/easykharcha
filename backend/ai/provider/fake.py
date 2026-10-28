"""AI_FAKE=true — deterministic canned results, used by tests/dev and CI, never the real API. Runs
its canned responses through the exact same parse/validate/fallback harness (base.run_with_fallback)
the real provider uses, so a deliberately malformed canned response exercises the same rejection
path a bad real-model response would. Token counts (2,500 in / 1,200 out for a menu scan, 800/300
for a recipe call) are realistic-sized so AiUsage.est_cost_usd and the monthly cap behave the same
as they would against the real API. Markers drive the smoke suite's edge cases:

- A file (menu scan) or dish name (recipe suggestion) containing "FORCE_BAD_SCHEMA" fails schema
  validation on the first attempt and succeeds on the fallback — proves the fallback path.
- "FORCE_BAD_SCHEMA_PERSISTENT" fails on both attempts — proves the "both attempts invalid" path.
- A menu scan file containing "NOT_A_MENU" returns is_menu=false.
- A menu scan file containing "FORCE_MAX_TOKENS" returns a valid-but-truncated result (stop reason
  max_tokens) — proves the incomplete-scan path (ai/jobs.py).
- A menu scan file containing "FORCE_MANY_DISHES" returns a large canned menu (200 dishes), used by
  the smoke suite to prove a long menu isn't silently cut short.
- A menu scan file containing "FORCE_PRICE_VARIANTS" returns a dish whose variants are plain prices
  — proves schemas.py's variant validator strips them rather than passing them through.
- A menu scan file containing "FORCE_SLASH_VARIANT" returns a dish like "Gobi Manchurian/65" with
  variants on both sides of the slash — proves the short bare-number side ("65", a dish style, not
  a price) survives schemas.py's variant validator.
- A recipe-suggestion dish name containing "FORCE_NAME_ALIAS" returns the dish keyed "name" instead
  of "dish_name" on the first attempt — proves schemas.py accepts "name" as an alias instead of
  burning a fallback-model retry on it.
"""

from django.conf import settings

from ..schemas import BaseDiscoveryResult, MenuExtractionResult, RecipeSuggestionsResult
from .base import AiCallResult, run_with_fallback

_FAKE_MODEL = "fake-ai-model"
_MENU_INPUT_TOKENS = 2500
_MENU_OUTPUT_TOKENS = 1200
_RECIPE_INPUT_TOKENS = 800
_RECIPE_OUTPUT_TOKENS = 300
_KITCHEN_INPUT_TOKENS = 3000
_KITCHEN_OUTPUT_TOKENS = 900

# Dish-name keyword -> (template name, grams/ml per portion) — a stand-in for the real model's
# judgement, just enough to exercise the discovery pipeline (option expansion, caching, sanity
# checks) end to end without a network call. Keys are checked in order, first match wins per dish.
_KEYWORD_TEMPLATES = [
    (("manchurian", "chilli", "schezwan", "chinese"), "Indo-Chinese sauce base", 80),
    (("65", "fry", "crispy", "lollipop"), "Frying batter", 40),
    (("makhani", "butter"), "Makhani/butter base", 200),
    (("korma", "white gravy"), "White gravy", 180),
    (("curry", "masala", "gravy"), "Onion-tomato masala", 200),
    (("rice",), "Cooked rice", 250),
    (("roti", "chapathi", "paratha", "naan"), "Atta dough", 70),
]


def extract_menu(files: list[dict], business_type: str) -> AiCallResult:
    blobs = [file["data"] for file in files]
    force_bad = any(b"FORCE_BAD_SCHEMA" in blob for blob in blobs)
    force_bad_persistent = any(b"FORCE_BAD_SCHEMA_PERSISTENT" in blob for blob in blobs)
    force_max_tokens = any(b"FORCE_MAX_TOKENS" in blob for blob in blobs)
    force_many_dishes = any(b"FORCE_MANY_DISHES" in blob for blob in blobs)
    force_price_variants = any(b"FORCE_PRICE_VARIANTS" in blob for blob in blobs)
    force_slash_variant = any(b"FORCE_SLASH_VARIANT" in blob for blob in blobs)
    is_menu = not any(b"NOT_A_MENU" in blob for blob in blobs)

    def get_raw(attempt: int, model: str) -> tuple[dict, str, int, int, bool]:
        if force_bad_persistent or (force_bad and attempt == 0):
            return (
                {"is_menu": "not-a-boolean"},
                model,
                _MENU_INPUT_TOKENS,
                _MENU_OUTPUT_TOKENS,
                False,
            )
        if not is_menu:
            return (
                {"is_menu": False, "sections": []},
                model,
                _MENU_INPUT_TOKENS,
                _MENU_OUTPUT_TOKENS,
                False,
            )
        if force_price_variants:
            dishes = [
                {
                    "name": "Chicken Lollipop / Drums of Heaven",
                    "price": 300,
                    "confidence": 0.9,
                    "variants": ["300", "Rs 320"],
                }
            ]
            return (
                {"is_menu": True, "sections": [{"name": "Menu", "dishes": dishes}]},
                model,
                _MENU_INPUT_TOKENS,
                _MENU_OUTPUT_TOKENS,
                False,
            )
        if force_slash_variant:
            dishes = [
                {
                    "name": "Gobi Manchurian/65",
                    "price": 180,
                    "confidence": 0.9,
                    "note": "has options",
                    "variants": ["Manchurian", "65"],
                }
            ]
            return (
                {"is_menu": True, "sections": [{"name": "Menu", "dishes": dishes}]},
                model,
                _MENU_INPUT_TOKENS,
                _MENU_OUTPUT_TOKENS,
                False,
            )
        if force_many_dishes:
            dishes = [
                {"name": f"Fake Dish {i}", "price": 100 + i, "confidence": 0.9}
                for i in range(1, 201)
            ]
            return (
                {"is_menu": True, "sections": [{"name": "Menu", "dishes": dishes}]},
                model,
                _MENU_INPUT_TOKENS,
                _MENU_OUTPUT_TOKENS,
                False,
            )
        dishes = [
            {"name": "Fake Dish 1", "price": 110, "confidence": 0.95},
            {"name": "Fake Dish 2", "price": 120, "confidence": 0.95},
            {
                "name": "Fake Dish 3 (Veg/Chicken)",
                "price": 130,
                "confidence": 0.8,
                "note": "has options",
                "variants": ["Veg", "Chicken"],
            },
            {
                "name": "Extra Cheese",
                "price": 30,
                "confidence": 0.9,
                "kind": "addon",
            },
        ]
        return (
            {"is_menu": True, "sections": [{"name": "Menu", "dishes": dishes}]},
            model,
            _MENU_INPUT_TOKENS,
            _MENU_OUTPUT_TOKENS,
            force_max_tokens,
        )

    return run_with_fallback(
        primary_model=settings.AI_MODEL_MENU,
        fallback_model=settings.AI_MODEL_FALLBACK,
        get_raw=get_raw,
        parse=lambda raw: MenuExtractionResult.model_validate(raw).sanitized(),
    )


def suggest_recipes(
    dish_names: list[str], business_type: str, stock_items: list[tuple[str, str]]
) -> AiCallResult:
    force_bad_persistent = any("FORCE_BAD_SCHEMA_PERSISTENT" in name for name in dish_names)
    force_bad = force_bad_persistent or any("FORCE_BAD_SCHEMA" in name for name in dish_names)
    force_name_alias = any("FORCE_NAME_ALIAS" in name for name in dish_names)
    default_match = stock_items[0][0] if stock_items else None

    def get_raw(attempt: int, model: str) -> tuple[dict, str, int, int, bool]:
        if force_bad_persistent or (force_bad and attempt == 0):
            # Missing the required dish_name field — genuinely invalid, not just sparse.
            return (
                {"dishes": [{"portion_label": "bad"}]},
                model,
                _RECIPE_INPUT_TOKENS,
                _RECIPE_OUTPUT_TOKENS,
                False,
            )
        name_key = "name" if force_name_alias else "dish_name"
        result_dishes = [
            {
                name_key: name,
                "portion_label": "1 plate",
                "ingredients": [
                    {
                        "name": default_match or "Rice",
                        "amount": 50.0 + (len(name) % 150),
                        "unit": "g",
                        "role": "main",
                        "confidence": 0.85,
                        "matched_stock_name": default_match,
                    }
                ],
                "minor_ingredients": [
                    {
                        "name": "Salt",
                        "amount": 1.5,
                        "unit": "g",
                        "role": "auxiliary",
                        "confidence": 0.6,
                        "matched_stock_name": None,
                    }
                ],
            }
            for name in dish_names
        ]
        return {"dishes": result_dishes}, model, _RECIPE_INPUT_TOKENS, _RECIPE_OUTPUT_TOKENS, False

    return run_with_fallback(
        primary_model=settings.AI_MODEL_RECIPE,
        fallback_model=settings.AI_MODEL_FALLBACK,
        get_raw=get_raw,
        parse=lambda raw: RecipeSuggestionsResult.model_validate(raw).model_dump(),
    )


def discover_bases(
    dishes: list[dict], sector: str, stock_item_names: list[str], library: dict
) -> AiCallResult:
    templates_by_name = {t["name"]: t for t in library.get("base_templates", [])}
    dishes_by_template: dict[str, list[dict]] = {}
    for dish in dishes:
        name_lower = dish["name"].lower()
        for keywords, template_name, grams in _KEYWORD_TEMPLATES:
            if template_name not in templates_by_name:
                continue
            if any(keyword in name_lower for keyword in keywords):
                dishes_by_template.setdefault(template_name, []).append(
                    {"dish": dish["name"], "grams_per_portion": grams}
                )
                break

    bases = []
    for template_name, used_by in dishes_by_template.items():
        if len(used_by) < 3:
            continue
        template = templates_by_name[template_name]
        bases.append(
            {
                "name": template["name"],
                "type": template.get("type", ""),
                "batch_ingredients": [
                    {"name": i["name"], "qty": i["qty"], "unit": i["unit"]}
                    for i in template["formula"]
                ],
                "yield_qty": template.get("batch_yield_qty", 1000),
                "used_by": used_by,
                "confidence": 0.9,
                "source": "library",
                "reason": f"used by {len(used_by)} dishes",
            }
        )

    def get_raw(_attempt: int, model: str) -> tuple[dict, str, int, int, bool]:
        return (
            {"bases": bases},
            model,
            _KITCHEN_INPUT_TOKENS,
            _KITCHEN_OUTPUT_TOKENS,
            False,
        )

    return run_with_fallback(
        primary_model=settings.AI_MODEL_KITCHEN,
        fallback_model=settings.AI_MODEL_FALLBACK,
        get_raw=get_raw,
        parse=lambda raw: BaseDiscoveryResult.model_validate(raw).model_dump(),
    )
