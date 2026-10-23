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
from decimal import Decimal
from pathlib import Path

# Redirected output (e.g. `> out.txt`) otherwise falls back to the console's codepage on Windows,
# mangling the em dash and any Hindi/Kannada text in a menu's dish names.
sys.stdout.reconfigure(encoding="utf-8")

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402

from ai.extraction import run_menu_extraction  # noqa: E402
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
        Decimal(input_tokens) / Decimal(1_000_000) * settings.AI_PRICE_IN_PER_MTOK
        + Decimal(output_tokens) / Decimal(1_000_000) * settings.AI_PRICE_OUT_PER_MTOK
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
    outcome = run_menu_extraction(
        files, args.business_type, extract_fn=anthropic_provider.extract_menu
    )

    print(f"\n{len(outcome.calls)} model call(s):")
    for call in outcome.calls:
        flag = " [TRUNCATED]" if call.truncated else ""
        print(
            f"  {call.label}: {call.input_tokens} in / {call.output_tokens} out "
            f"(~{_cost(call.input_tokens, call.output_tokens)}) [{call.model}]{flag}"
        )
    print(
        f"Total: {outcome.total_input_tokens} in / {outcome.total_output_tokens} out "
        f"(~{_cost(outcome.total_input_tokens, outcome.total_output_tokens)})"
    )

    if outcome.incomplete:
        print("\nWARNING: at least one page overflowed max_tokens even on retry — this result is incomplete.")

    if not outcome.merged["is_menu"]:
        print("\nis_menu: false — the model doesn't think this is a menu.")
        return

    dish_names = []
    total_dishes = 0
    for section in outcome.merged["sections"]:
        print(f"\n{section['name']} ({len(section['dishes'])} dishes)")
        for dish in section["dishes"]:
            price = f"Rs {dish['price']}" if dish["price"] is not None else "(no price)"
            extras = []
            if dish.get("kind") == "addon":
                extras.append("addon")
            if dish.get("note"):
                extras.append(dish["note"])
            if dish.get("variants"):
                extras.append(f"variants: {', '.join(dish['variants'])}")
            extra_text = f" [{'; '.join(extras)}]" if extras else ""
            print(
                f"  - {dish['name']} — {price} (confidence {dish['confidence']:.2f}){extra_text}"
            )
            dish_names.append(dish["name"])
            total_dishes += 1
    print(f"\nTotal dishes: {total_dishes}")

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
        for ingredient in dish.get("minor_ingredients", []):
            print(
                f"  - (minor) {ingredient['name']}: {ingredient['amount']} {ingredient['unit']} "
                f"({ingredient['role']}, confidence {ingredient['confidence']:.2f})"
            )


if __name__ == "__main__":
    main()
