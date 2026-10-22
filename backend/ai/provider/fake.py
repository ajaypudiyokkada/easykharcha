"""AI_FAKE=true — deterministic canned results, used by tests/dev and CI, never the real API. Runs
its canned responses through the exact same parse/validate/fallback harness (base.run_with_fallback)
the real provider uses, so a deliberately malformed canned response exercises the same rejection
path a bad real-model response would. Two markers drive the smoke suite's edge cases:

- A file (menu scan) or dish name (recipe suggestion) containing "FORCE_BAD_SCHEMA" fails schema
  validation on the first attempt and succeeds on the fallback — proves the fallback path.
- "FORCE_BAD_SCHEMA_PERSISTENT" fails on both attempts — proves the "both attempts invalid" path.
- A menu scan file containing "NOT_A_MENU" returns is_menu=false.
"""

from django.conf import settings

from ..schemas import MenuExtractionResult, RecipeSuggestionsResult
from .base import AiCallResult, run_with_fallback

_FAKE_MODEL = "fake-ai-model"


def extract_menu(files: list[dict], business_type: str) -> AiCallResult:
    blobs = [file["data"] for file in files]
    force_bad = any(b"FORCE_BAD_SCHEMA" in blob for blob in blobs)
    force_bad_persistent = any(b"FORCE_BAD_SCHEMA_PERSISTENT" in blob for blob in blobs)
    is_menu = not any(b"NOT_A_MENU" in blob for blob in blobs)

    def get_raw(attempt: int, model: str) -> tuple[dict, str, int, int]:
        if force_bad_persistent or (force_bad and attempt == 0):
            return {"is_menu": "not-a-boolean"}, model, 400, 120
        if not is_menu:
            return {"is_menu": False, "sections": []}, model, 400, 120
        dishes = [
            {"name": f"Fake Dish {i}", "price": 100 + i * 10, "confidence": 0.9}
            for i in range(1, 4)
        ]
        return {"is_menu": True, "sections": [{"name": "Menu", "dishes": dishes}]}, model, 400, 120

    return run_with_fallback(
        primary_model=settings.AI_MODEL_MENU,
        fallback_model=settings.AI_MODEL_FALLBACK,
        get_raw=get_raw,
        parse=lambda raw: MenuExtractionResult.model_validate(raw).sanitized(),
    )


def suggest_recipes(
    dish_names: list[str], business_type: str, stock_item_names: list[str]
) -> AiCallResult:
    force_bad_persistent = any("FORCE_BAD_SCHEMA_PERSISTENT" in name for name in dish_names)
    force_bad = force_bad_persistent or any("FORCE_BAD_SCHEMA" in name for name in dish_names)
    default_match = stock_item_names[0] if stock_item_names else None

    def get_raw(attempt: int, model: str) -> tuple[dict, str, int, int]:
        if force_bad_persistent or (force_bad and attempt == 0):
            # Missing the required dish_name field — genuinely invalid, not just sparse.
            return {"dishes": [{"portion_label": "bad"}]}, model, 200, 80
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
                        "confidence": 0.7,
                        "matched_stock_name": default_match,
                    }
                ],
            }
            for name in dish_names
        ]
        return {"dishes": result_dishes}, model, 200, 80

    return run_with_fallback(
        primary_model=settings.AI_MODEL_RECIPE,
        fallback_model=settings.AI_MODEL_FALLBACK,
        get_raw=get_raw,
        parse=lambda raw: RecipeSuggestionsResult.model_validate(raw).model_dump(),
    )
