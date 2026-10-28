"""Step EK-2: classifies every dish into a fixed type (+ family/style tag) from backend/ai/
knowledge/dish_types.json, batched to keep each model call small and cheap. Cached PER DISH NAME
(not per menu, unlike AiKitchenBaseCache) since a dish's kitchen-prep type doesn't depend on what
else is on the same menu — reusable across every menu/business in the same sector."""

from . import provider
from .knowledge import load_dish_types
from .matching import normalise
from .models import AiDishTypeCache
from .prompts import CLASSIFY_PROMPT_VERSION

BATCH_SIZE = 60


def classify_dishes(
    dishes: list[dict], sector: str, *, classify_fn=None
) -> tuple[dict[str, dict], list[dict]]:
    """Returns ({normalised_name: {"type", "family", "confidence"}}, usage_per_batch) — usage_per_batch
    is empty when every dish was already cached (no model call made), otherwise one entry per batch
    actually sent. `classify_fn` defaults to provider.classify_dishes (AI_FAKE-aware dispatch);
    scripts/ai_try_kitchen.py passes anthropic_provider.classify_dishes directly, same extract_fn/
    discover_fn pattern as the other two AI pipelines. A dish the model drops from its own batch
    response still gets a bucket ("other", confidence 0) so the mapping step never silently skips it."""
    classify = classify_fn or provider.classify_dishes
    dish_types = load_dish_types()
    names = [d["name"] for d in dishes]
    by_norm: dict[str, dict] = {}
    usage: list[dict] = []

    cached_rows = AiDishTypeCache.objects.filter(
        dish_name_normalised__in={normalise(n) for n in names},
        sector=sector,
        prompt_version=CLASSIFY_PROMPT_VERSION,
    )
    for row in cached_rows:
        by_norm[row.dish_name_normalised] = row.result

    to_classify = [n for n in names if normalise(n) not in by_norm]
    for start in range(0, len(to_classify), BATCH_SIZE):
        batch = to_classify[start : start + BATCH_SIZE]
        result = classify(batch, sector, dish_types)
        usage.append(
            {
                "model": result.model,
                "input_tokens": result.input_tokens,
                "output_tokens": result.output_tokens,
                "used_fallback": result.used_fallback,
            }
        )
        for dish in result.data["dishes"]:
            key = normalise(dish["name"])
            dish_type = dish["type"] if dish["type"] in dish_types else "other"
            classified = {
                "type": dish_type,
                "family": dish.get("family", ""),
                "confidence": dish["confidence"],
            }
            by_norm[key] = classified
            AiDishTypeCache.objects.update_or_create(
                dish_name_normalised=key,
                sector=sector,
                prompt_version=CLASSIFY_PROMPT_VERSION,
                defaults={"result": classified},
            )
        for name in batch:
            by_norm.setdefault(normalise(name), {"type": "other", "family": "", "confidence": 0.0})

    return by_norm, usage
