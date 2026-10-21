"""Guards against kitchen/restaurant wording leaking into non-food business types.

Checks two sources that vary by business type: mobile/src/sectorCopy.json (the sector copy config
every screen reads) and backend/businesses/starter_packs.json (the starter stock/sell catalogue).
Food business types are allow-listed, since words like "kitchen" or "chef" are correct there.
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SECTOR_COPY_PATH = REPO_ROOT / "mobile" / "src" / "sectorCopy.json"
STARTER_PACKS_PATH = REPO_ROOT / "backend" / "businesses" / "starter_packs.json"

# Business types where "dish", "chef", "kitchen" etc. are the correct wording.
FOOD_BUSINESS_TYPES = {"restaurant_cafe", "cloud_kitchen", "bakery_sweets", "tiffin_catering"}

FORBIDDEN_WORDS = [
    "dish",
    "dishes",
    "recipe",
    "recipes",
    "menu",
    "menus",
    "kitchen",
    "kitchens",
    "chef",
    "chefs",
    "cook",
    "cooks",
    "cooking",
    "cooked",
    "ingredient",
    "ingredients",
    "serve",
    "serves",
    "served",
    "serving",
    "portion",
    "portions",
    "thrown",
]
FORBIDDEN_RE = re.compile(r"\b(" + "|".join(FORBIDDEN_WORDS) + r")\b", re.IGNORECASE)


def strings_in(value):
    """Every string found anywhere inside a (possibly nested) JSON value."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from strings_in(v)
    elif isinstance(value, list):
        for v in value:
            yield from strings_in(v)


def check_sector_copy():
    data = json.loads(SECTOR_COPY_PATH.read_text(encoding="utf-8"))
    failures = []
    for business_type, config in data.items():
        if business_type in FOOD_BUSINESS_TYPES:
            continue
        for text in strings_in(config):
            match = FORBIDDEN_RE.search(text)
            if match:
                failures.append((SECTOR_COPY_PATH, business_type, match.group(0), text))
    return failures


def check_starter_packs():
    data = json.loads(STARTER_PACKS_PATH.read_text(encoding="utf-8"))
    failures = []
    for business_type, pack in data.items():
        if business_type in FOOD_BUSINESS_TYPES:
            continue
        for section in ("stock_items", "sell_items"):
            for item in pack.get(section, []):
                for field in ("name", "group"):
                    text = item.get(field, "")
                    match = FORBIDDEN_RE.search(text)
                    if match:
                        failures.append(
                            (STARTER_PACKS_PATH, business_type, match.group(0), f"{section}.{field}: {text}")
                        )
    return failures


def check_catalogue_units():
    """Every starter-pack stock item's unit must be one of its business type's allowedUnits —
    the config only controls which units the UI *offers first*, but a mismatch here would mean the
    catalogue was never actually reachable through that offer."""
    sector_copy = json.loads(SECTOR_COPY_PATH.read_text(encoding="utf-8"))
    packs = json.loads(STARTER_PACKS_PATH.read_text(encoding="utf-8"))
    failures = []
    for business_type, pack in packs.items():
        allowed = set(sector_copy[business_type]["allowedUnits"])
        for item in pack.get("stock_items", []):
            if item["unit"] not in allowed:
                failures.append(
                    (STARTER_PACKS_PATH, business_type, item["unit"], f"stock_items: {item['name']}")
                )
    return failures


def main():
    failures = check_sector_copy() + check_starter_packs() + check_catalogue_units()
    if failures:
        print("sector-copy checks failed:\n")
        for path, business_type, word, text in failures:
            print(f"  {path.relative_to(REPO_ROOT)} [{business_type}]: {word!r} in {text!r}")
        print(f"\n{len(failures)} failure(s).")
        sys.exit(1)
    print("check_sector_copy: wording and starter-catalogue units are all sector-correct.")


if __name__ == "__main__":
    main()
