"""Step EK-2: classifies every dish into a fixed type (+ family/style tag) from backend/ai/
knowledge/dish_types.json, batched to keep each model call small and cheap. Cached PER DISH NAME
(not per menu, unlike AiKitchenBaseCache) since a dish's kitchen-prep type doesn't depend on what
else is on the same menu — reusable across every menu/business in the same sector."""

from . import provider
from .knowledge import load_dish_types, load_library
from .matching import normalise
from .models import AiDishTypeCache
from .prompts import CLASSIFY_PROMPT_VERSION

BATCH_SIZE = 60


def _apply_keyword_override(name: str, classified: dict, overrides: list[dict]) -> dict:
    """Step EK-2c: a deterministic safety net over the model's own classification — a sector's
    knowledge/<sector>.json can list keyword -> type/family rules (e.g. "malai" always means
    grilled_tandoori, never gravy_makhani) that the model is not allowed to override, applied to
    every lookup (fresh model call AND a cache hit, so a stale cache row from before a rule existed
    still gets corrected). First matching rule wins; no match leaves `classified` untouched."""
    name_norm = normalise(name)
    for rule in overrides:
        if any(keyword in name_norm for keyword in rule["keywords"]):
            return {
                "type": rule["type"],
                "family": rule.get("family", classified.get("family", "")),
                "confidence": max(classified.get("confidence", 0.0), 0.9),
            }
    return classified


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
    overrides = load_library(sector).get("rules", {}).get("keyword_type_overrides", [])
    names = [d["name"] for d in dishes]
    by_norm: dict[str, dict] = {}
    usage: list[dict] = []

    cached_rows = AiDishTypeCache.objects.filter(
        dish_name_normalised__in={normalise(n) for n in names},
        sector=sector,
        prompt_version=CLASSIFY_PROMPT_VERSION,
    )
    for row in cached_rows:
        by_norm[row.dish_name_normalised] = _apply_keyword_override(
            row.dish_name_normalised, row.result, overrides
        )

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
            classified = _apply_keyword_override(dish["name"], classified, overrides)
            by_norm[key] = classified
            AiDishTypeCache.objects.update_or_create(
                dish_name_normalised=key,
                sector=sector,
                prompt_version=CLASSIFY_PROMPT_VERSION,
                defaults={"result": classified},
            )
        for name in batch:
            by_norm.setdefault(
                normalise(name),
                _apply_keyword_override(
                    name, {"type": "other", "family": "", "confidence": 0.0}, overrides
                ),
            )

    return by_norm, usage
