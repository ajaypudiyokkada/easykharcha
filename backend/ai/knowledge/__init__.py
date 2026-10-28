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
    "rules": {
        "min_dishes_to_suggest_base": 3,
        "min_grams_per_portion": 30,
        "excluded_by_default": [],
    },
}


def load_library(sector: str) -> dict:
    path = _KNOWLEDGE_DIR / f"{sector}.json"
    if not path.exists():
        return {**EMPTY_LIBRARY, "sector": sector}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {**EMPTY_LIBRARY, **data}
