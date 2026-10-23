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
"""

from django.conf import settings

from ..schemas import MenuExtractionResult, RecipeSuggestionsResult
from .base import AiCallResult, run_with_fallback

_FAKE_MODEL = "fake-ai-model"
_MENU_INPUT_TOKENS = 2500
_MENU_OUTPUT_TOKENS = 1200
_RECIPE_INPUT_TOKENS = 800
_RECIPE_OUTPUT_TOKENS = 300


def extract_menu(files: list[dict], business_type: str) -> AiCallResult:
    blobs = [file["data"] for file in files]
    force_bad = any(b"FORCE_BAD_SCHEMA" in blob for blob in blobs)
    force_bad_persistent = any(b"FORCE_BAD_SCHEMA_PERSISTENT" in blob for blob in blobs)
    force_max_tokens = any(b"FORCE_MAX_TOKENS" in blob for blob in blobs)
    force_many_dishes = any(b"FORCE_MANY_DISHES" in blob for blob in blobs)
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
        result_dishes = [
            {
                "dish_name": name,
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
