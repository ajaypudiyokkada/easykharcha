#!/usr/bin/env python
"""Try the real AI menu-reading and recipe-suggestion calls against one menu file, using the real
ANTHROPIC_API_KEY from backend/.env — never AI_FAKE, regardless of what's set there. For checking
prompt quality against real menus by hand, not part of any automated check.

Usage:
    python scripts/ai_try_menu.py path/to/menu.jpg --type restaurant_cafe
    python scripts/ai_try_menu.py path/to/menu.pdf --type tiffin_catering

Sample menus belong in the git-ignored backend/_private/menus/ folder — nothing under _private/ is
ever committed (see .gitignore), so that's a safe place to keep real photos for this script.
"""

import argparse
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402

from ai.provider import anthropic_provider  # noqa: E402
from businesses.models import BusinessType  # noqa: E402

_MEDIA_TYPE_BY_SUFFIX = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
}


def _cost(input_tokens: int, output_tokens: int) -> str:
    cost = (
        input_tokens / 1_000_000 * settings.AI_PRICE_IN_PER_MTOK
        + output_tokens / 1_000_000 * settings.AI_PRICE_OUT_PER_MTOK
    )
    return f"${cost:.4f}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("menu_file", type=Path, help="Path to one menu image or PDF")
    parser.add_argument(
        "--type", dest="business_type", required=True, choices=[c.value for c in BusinessType]
    )
    args = parser.parse_args()

    if not settings.ANTHROPIC_API_KEY:
        print("No ANTHROPIC_API_KEY set in backend/.env — refusing to run.", file=sys.stderr)
        sys.exit(1)

    if not args.menu_file.exists():
        print(f"No such file: {args.menu_file}", file=sys.stderr)
        sys.exit(1)

    suffix = args.menu_file.suffix.lower()
    media_type = _MEDIA_TYPE_BY_SUFFIX.get(suffix)
    if media_type is None:
        print(f"Unrecognised file type {suffix!r} — use .jpg/.jpeg/.png/.webp/.pdf.", file=sys.stderr)
        sys.exit(1)

    print(f"Reading {args.menu_file} as {args.business_type}...")
    files = [{"media_type": media_type, "data": args.menu_file.read_bytes()}]
    menu_result = anthropic_provider.extract_menu(files, args.business_type)

    print(f"\nModel: {menu_result.model} (fallback used: {menu_result.used_fallback})")
    print(
        f"Tokens: {menu_result.input_tokens} in / {menu_result.output_tokens} out "
        f"(~{_cost(menu_result.input_tokens, menu_result.output_tokens)})"
    )

    if not menu_result.data["is_menu"]:
        print("\nis_menu: false — the model doesn't think this is a menu.")
        return

    dish_names = []
    for section in menu_result.data["sections"]:
        print(f"\n{section['name']}")
        for dish in section["dishes"]:
            price = f"Rs {dish['price']}" if dish["price"] is not None else "(no price)"
            print(f"  - {dish['name']} — {price} (confidence {dish['confidence']:.2f})")
            dish_names.append(dish["name"])

    if not dish_names:
        return

    first_five = dish_names[:5]
    print(f"\nSuggesting recipes for: {', '.join(first_five)}")
    recipe_result = anthropic_provider.suggest_recipes(first_five, args.business_type, [])
    print(
        f"Model: {recipe_result.model} — tokens {recipe_result.input_tokens} in / "
        f"{recipe_result.output_tokens} out (~{_cost(recipe_result.input_tokens, recipe_result.output_tokens)})"
    )
    for dish in recipe_result.data["dishes"]:
        print(f"\n{dish['dish_name']} ({dish['portion_label']})")
        for ingredient in dish["ingredients"]:
            print(
                f"  - {ingredient['name']}: {ingredient['amount']} {ingredient['unit']} "
                f"({ingredient['role']}, confidence {ingredient['confidence']:.2f})"
            )


if __name__ == "__main__":
    main()
