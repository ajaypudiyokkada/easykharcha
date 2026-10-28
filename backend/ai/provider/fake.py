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
- A menu scan file containing "FORCE_PREFIX_GROUP" returns a "Chicken" heading with variants
  ["Manchurian", "Chilli", "Pepper", "Lemon"], variant_position "prefix" — proves
  base_discovery.expand_dish_options builds "Chicken Manchurian" etc (heading first).
- "FORCE_SUFFIX_GROUP" returns a "Manchurian" heading with variants ["Gobi", "Paneer", "Babycorn",
  "Mushroom"], variant_position "suffix" — proves expand_dish_options builds "Gobi Manchurian" etc
  (heading last), never leaving a bare "Manchurian" dish in the expanded output.
- "FORCE_TWO_PRICE_GROUP" returns a "Sweetcorn Soup" row with variants ["Veg", "Chicken"] priced
  [120, 150] via variant_prices — proves expand_dish_options gives each expanded dish its own price.
- "FORCE_BARE_GROUP" (Step EK-2b) returns a BROKEN first pass: a bare "Manchurian" dish with no
  variants at all, standing alone — the designed-menu failure mode the dedicated group pass exists
  to fix. extract_menu_groups for this marker returns the correct group (heading "Manchurian",
  dishes "Gobi Manchurian"/"Paneer Manchurian") — proves base_discovery.apply_groups drops the bare
  "Manchurian" leftover and adds the group's own final dish names instead.
- "FORCE_DOUBLE_EXPANDED_GROUP" (Step EK-2c) returns a first pass that ALREADY expanded a "Manchurian"
  heading via its own inline variants (producing "Gobi Manchurian"/"Paneer Manchurian" itself,
  correctly) — extract_menu_groups for this marker finds the SAME heading independently (dishes
  "Gobi Manchurian"/"Paneer Manchurian" again). Proves apply_groups' one-source-of-truth rule: the
  group pass's own dishes win, the first pass's matching expansion is dropped, not duplicated.
- "FORCE_CHOICE_FRAGMENT_GROUP" (Step EK-2c) returns a first pass with 3 bare choice-word dishes
  ("Veg", "Egg", "Mixed" — no heading, no variants) plus one unrelated dish ("Something Else"),
  mimicking a real Kavan bug: the main pass misread a "Fried Rice/Noodles" price table's column
  labels as standalone dishes. extract_menu_groups for this marker correctly finds the whole group
  (8 final dishes: Fried Rice/Noodles x Veg/Egg/Chicken/Mixed) — proves base_discovery.apply_groups's
  _is_choice_fragment drops the 3 bare fragments (never a real dish on their own) while leaving
  "Something Else" alone.
"""

from django.conf import settings

from ..schemas import (
    DishClassificationResult,
    GroupExtractionResult,
    MenuExtractionResult,
    RecipeSuggestionsResult,
)
from .base import AiCallResult, run_with_fallback

_FAKE_MODEL = "fake-ai-model"
_MENU_INPUT_TOKENS = 2500
_MENU_OUTPUT_TOKENS = 1200
_RECIPE_INPUT_TOKENS = 800
_RECIPE_OUTPUT_TOKENS = 300
_KITCHEN_INPUT_TOKENS = 600
_KITCHEN_OUTPUT_TOKENS = 400

# Dish-name keyword -> (type, family) — a stand-in for the real model's judgement, just enough to
# exercise classify-then-map end to end without a network call. Checked in order, first match wins.
_KEYWORD_TYPES = [
    (("manchurian gravy", "chilli gravy"), "gravy_chinese", "chinese gravy"),
    (("manchurian", "chilli", "schezwan", "noodles"), "fried_starter_tossed", "manchurian"),
    (("tandoori", "grill", "kebab", "kabab"), "grilled_tandoori", "tandoori"),
    (
        ("65", "fry", "crispy", "lollipop", "pakoda", "finger", "cutlet"),
        "fried_starter_dry",
        "fried",
    ),
    (("makhani", "butter chicken", "butter paneer", "malai"), "gravy_makhani", "makhani"),
    (("mutton", "lamb"), "gravy_nonveg", "mutton"),
    # Checked before the generic "curry"/"masala"/"kadai" catch-all below, so a veg dish that
    # happens to also say "curry" (e.g. "Paneer Curry") lands on gravy_veg, not gravy_nonveg.
    (("paneer", "veg kurma", "vegetable curry"), "gravy_veg", "veg curry"),
    (("chicken curry", "curry", "masala", "kadai"), "gravy_nonveg", "curry"),
    (("fried rice",), "rice_fried", "fried rice"),
    (("rice",), "rice_plain", "plain rice"),
    (("paratha",), "bread_dough", "paratha"),
    (("roti", "chapathi", "naan"), "bread_dough", "chapathi"),
    (("soup",), "soup", "soup"),
]


def extract_menu(files: list[dict], business_type: str) -> AiCallResult:
    blobs = [file["data"] for file in files]
    force_bad = any(b"FORCE_BAD_SCHEMA" in blob for blob in blobs)
    force_bad_persistent = any(b"FORCE_BAD_SCHEMA_PERSISTENT" in blob for blob in blobs)
    force_max_tokens = any(b"FORCE_MAX_TOKENS" in blob for blob in blobs)
    force_many_dishes = any(b"FORCE_MANY_DISHES" in blob for blob in blobs)
    force_price_variants = any(b"FORCE_PRICE_VARIANTS" in blob for blob in blobs)
    force_slash_variant = any(b"FORCE_SLASH_VARIANT" in blob for blob in blobs)
    force_prefix_group = any(b"FORCE_PREFIX_GROUP" in blob for blob in blobs)
    force_suffix_group = any(b"FORCE_SUFFIX_GROUP" in blob for blob in blobs)
    force_two_price_group = any(b"FORCE_TWO_PRICE_GROUP" in blob for blob in blobs)
    force_bare_group = any(b"FORCE_BARE_GROUP" in blob for blob in blobs)
    force_double_expanded_group = any(b"FORCE_DOUBLE_EXPANDED_GROUP" in blob for blob in blobs)
    force_choice_fragment_group = any(b"FORCE_CHOICE_FRAGMENT_GROUP" in blob for blob in blobs)
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
        if force_prefix_group:
            dishes = [
                {
                    "name": "Chicken",
                    "price": 290,
                    "confidence": 0.9,
                    "note": "has options",
                    "variants": ["Manchurian", "Chilli", "Pepper", "Lemon"],
                    "variant_position": "prefix",
                }
            ]
            return (
                {"is_menu": True, "sections": [{"name": "Menu", "dishes": dishes}]},
                model,
                _MENU_INPUT_TOKENS,
                _MENU_OUTPUT_TOKENS,
                False,
            )
        if force_suffix_group:
            dishes = [
                {
                    "name": "Manchurian",
                    "price": 270,
                    "confidence": 0.9,
                    "note": "has options",
                    "variants": ["Gobi", "Paneer", "Babycorn", "Mushroom"],
                    "variant_position": "suffix",
                }
            ]
            return (
                {"is_menu": True, "sections": [{"name": "Menu", "dishes": dishes}]},
                model,
                _MENU_INPUT_TOKENS,
                _MENU_OUTPUT_TOKENS,
                False,
            )
        if force_two_price_group:
            dishes = [
                {
                    "name": "Sweetcorn Soup",
                    "price": 120,
                    "confidence": 0.9,
                    "note": "has options",
                    "variants": ["Veg", "Chicken"],
                    "variant_position": "prefix",
                    "variant_prices": [120, 150],
                }
            ]
            return (
                {"is_menu": True, "sections": [{"name": "Menu", "dishes": dishes}]},
                model,
                _MENU_INPUT_TOKENS,
                _MENU_OUTPUT_TOKENS,
                False,
            )
        if force_bare_group:
            dishes = [{"name": "Manchurian", "price": 270, "confidence": 0.9}]
            return (
                {"is_menu": True, "sections": [{"name": "Menu", "dishes": dishes}]},
                model,
                _MENU_INPUT_TOKENS,
                _MENU_OUTPUT_TOKENS,
                False,
            )
        if force_double_expanded_group:
            dishes = [
                {
                    "name": "Manchurian",
                    "price": 270,
                    "confidence": 0.9,
                    "note": "has options",
                    "variants": ["Gobi", "Paneer"],
                    "variant_position": "suffix",
                }
            ]
            return (
                {"is_menu": True, "sections": [{"name": "Menu", "dishes": dishes}]},
                model,
                _MENU_INPUT_TOKENS,
                _MENU_OUTPUT_TOKENS,
                False,
            )
        if force_choice_fragment_group:
            dishes = [
                {"name": "Veg", "price": 150, "confidence": 0.9},
                {"name": "Egg", "price": 170, "confidence": 0.9},
                {"name": "Mixed", "price": 200, "confidence": 0.9},
                {"name": "Something Else", "price": 120, "confidence": 0.9},
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


def extract_menu_groups(files: list[dict], business_type: str) -> AiCallResult:
    blobs = [file["data"] for file in files]
    force_bare_group = any(b"FORCE_BARE_GROUP" in blob for blob in blobs)
    force_double_expanded_group = any(b"FORCE_DOUBLE_EXPANDED_GROUP" in blob for blob in blobs)
    force_choice_fragment_group = any(b"FORCE_CHOICE_FRAGMENT_GROUP" in blob for blob in blobs)

    def get_raw(_attempt: int, model: str) -> tuple[dict, str, int, int, bool]:
        groups = []
        if force_bare_group or force_double_expanded_group:
            groups = [
                {
                    "heading": "Manchurian",
                    "dishes": [{"name": "Gobi Manchurian"}, {"name": "Paneer Manchurian"}],
                }
            ]
        elif force_choice_fragment_group:
            groups = [
                {
                    "heading": "Fried Rice/Noodles",
                    "dishes": [
                        {"name": "Fried Rice Veg", "price": 150},
                        {"name": "Fried Rice Egg", "price": 170},
                        {"name": "Fried Rice Chicken", "price": 190},
                        {"name": "Fried Rice Mixed", "price": 200},
                        {"name": "Noodles Veg", "price": 150},
                        {"name": "Noodles Egg", "price": 170},
                        {"name": "Noodles Chicken", "price": 190},
                        {"name": "Noodles Mixed", "price": 200},
                    ],
                }
            ]
        return ({"groups": groups}, model, _KITCHEN_INPUT_TOKENS, _KITCHEN_OUTPUT_TOKENS, False)

    return run_with_fallback(
        primary_model=settings.AI_MODEL_MENU,
        fallback_model=settings.AI_MODEL_FALLBACK,
        get_raw=get_raw,
        parse=lambda raw: GroupExtractionResult.model_validate(raw).sanitized(),
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


def classify_dishes(dish_names: list[str], sector: str, dish_types: list[str]) -> AiCallResult:
    dishes = []
    for name in dish_names:
        name_lower = name.lower()
        dish_type, family = "other", ""
        for keywords, candidate_type, candidate_family in _KEYWORD_TYPES:
            if candidate_type not in dish_types:
                continue
            if any(keyword in name_lower for keyword in keywords):
                dish_type, family = candidate_type, candidate_family
                break
        dishes.append({"name": name, "type": dish_type, "family": family, "confidence": 0.85})

    def get_raw(_attempt: int, model: str) -> tuple[dict, str, int, int, bool]:
        return ({"dishes": dishes}, model, _KITCHEN_INPUT_TOKENS, _KITCHEN_OUTPUT_TOKENS, False)

    return run_with_fallback(
        primary_model=settings.AI_MODEL_KITCHEN,
        fallback_model=settings.AI_MODEL_FALLBACK,
        get_raw=get_raw,
        parse=lambda raw: DishClassificationResult.model_validate(raw).model_dump(),
    )
