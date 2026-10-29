"""Sector-specific kitchen-base knowledge for base_discovery.py: template batch formulas (1,000 g/ml
each) and per-portion defaults the discovery skill prefers over asking the model to invent a base
from nothing. Plain data files (<sector>.json), not code. A sector with no file falls back to
EMPTY_LIBRARY (same shape, no templates), so the skill still works for it via the model alone."""

import json
from pathlib import Path

_KNOWLEDGE_DIR = Path(__file__).resolve().parent

EMPTY_LIBRARY: dict = {
    "sector": "",
    "base_templates": [],
    "portion_defaults": [],
    # Step EK-3: dish names/phrases this sector's owners tend to sell a lot of — recipe_composer.py's
    # best-seller picker scores candidates against this list before the one AI call that narrows them
    # down, same "library-first, model second" spirit as base discovery's type_rules.
    "popular_keywords": [],
    "rules": {
        "min_dishes_to_suggest_base": 3,
        "min_grams_per_portion": 30,
        "excluded_by_default": [],
        # Step EK-2c: deterministic name-keyword -> type/family overrides, applied AFTER the model's
        # own classification (classification.py) so the model can never misplace a dish the owner's
        # sector already has a firm rule for (e.g. "malai" dishes are tandoori, not makhani).
        "keyword_type_overrides": [],
        # Step EK-2d: deterministic protein+style keyword rule that adds a SECOND base (never
        # replaces the primary) to a dish real kitchens batter AND sauce — see base_discovery.
        # _secondary_types_for. None (not just {}) so a sector with no rule is a clean no-op.
        "two_base_starter_rule": None,
    },
    # Step EK-3b: canonical ingredient name -> the name/alias phrases that mean the same raw
    # ingredient (e.g. "capsicum"/"bell pepper"/"green capsicum" all buy the same thing) —
    # recipe_composer.resolve_ingredients canonicalises every ingredient name through this before
    # merging/matching, so near-duplicate stock items are never proposed for the same thing.
    "ingredient_aliases": {},
    # Step EK-3c: pairs of name-phrases that must NEVER end up as one merged stock item even if the
    # merge AI call groups them together — recipe_composer._group_is_safe checks every pair of a
    # proposed group's members against this list before trusting the merge (e.g. "rice flour" is not
    # "rice" — a milled product is never the same purchasable item as what it's milled from).
    "never_merge": [],
    # type (from dish_types.json) -> {"base": <base template name>, "grams_per_portion": N,
    # "family_overrides": {<family>: N}} | null (no base for that type) — the deterministic mapping
    # step (base_discovery.map_bases_from_classification) looks a classified dish's type up here
    # instead of asking the model to invent the mapping itself.
    "type_rules": {},
}


def load_library(sector: str) -> dict:
    path = _KNOWLEDGE_DIR / f"{sector}.json"
    if not path.exists():
        return {**EMPTY_LIBRARY, "sector": sector}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {**EMPTY_LIBRARY, **data}


_DISH_TYPES_PATH = _KNOWLEDGE_DIR / "dish_types.json"


def load_dish_types() -> list[str]:
    """The shared, sector-agnostic dish-type taxonomy every classify_dishes call constrains the
    model to — see dish_types.json. A sector's own type_rules (load_library) decides what each type
    maps to; the taxonomy itself doesn't vary by sector."""
    return json.loads(_DISH_TYPES_PATH.read_text(encoding="utf-8"))["types"]
