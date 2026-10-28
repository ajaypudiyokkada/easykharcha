#!/usr/bin/env python
"""Try the real kitchen-base-discovery call against one menu file, using the real ANTHROPIC_API_KEY
from backend/.env — never AI_FAKE. Reuses the same menu-extraction pipeline as ai_try_menu.py, then
expands inline dish options, then runs base discovery, and prints what it found.

Usage:
    python scripts/ai_try_kitchen.py path/to/menu.pdf --type restaurant_cafe

Sample menus belong in the git-ignored backend/_private/menus/ folder.
"""

import argparse
import os
import sys
from decimal import Decimal
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402

from ai.base_discovery import discover_bases, expand_dish_options  # noqa: E402
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
    media_type = _MEDIA_TYPE_BY_SUFFIX.get(args.menu_file.suffix.lower())
    if media_type is None:
        print(f"Unrecognised file type {args.menu_file.suffix!r}.", file=sys.stderr)
        sys.exit(1)

    print(f"Reading {args.menu_file} as {args.business_type}...")
    files = [{"media_type": media_type, "data": args.menu_file.read_bytes()}]
    outcome = run_menu_extraction(
        files, args.business_type, extract_fn=anthropic_provider.extract_menu
    )
    menu_cost = _cost(outcome.total_input_tokens, outcome.total_output_tokens)
    print(
        f"Menu extraction: {outcome.total_input_tokens} in / {outcome.total_output_tokens} out "
        f"(~{menu_cost}), {len(outcome.calls)} call(s)"
    )
    if not outcome.merged["is_menu"]:
        print("is_menu: false — stopping, nothing to discover bases for.")
        return

    raw_dishes = [
        {"name": dish["name"]}
        for section in outcome.merged["sections"]
        for dish in section["dishes"]
        if dish.get("kind", "dish") != "addon"
    ]
    print(f"\n{len(raw_dishes)} dishes (addons excluded) before option expansion")

    expanded = expand_dish_options(raw_dishes)
    expanded_count = sum(1 for d in expanded if "expanded_from" in d)
    print(f"{len(expanded)} dishes after option expansion ({expanded_count} came from an expanded line)")
    for dish in expanded:
        if "expanded_from" in dish:
            print(f"  - {dish['expanded_from']!r} -> {dish['name']!r}")

    print(f"\nRunning base discovery ({settings.AI_MODEL_KITCHEN})...")
    result = discover_bases(
        expanded, args.business_type, [], discover_fn=anthropic_provider.discover_bases
    )
    usage = result["usage"]
    if usage is None:
        print("(cache hit — no model call made)")
    else:
        kitchen_cost = _cost(usage["input_tokens"], usage["output_tokens"])
        fallback_note = " [fallback model]" if usage["used_fallback"] else ""
        print(
            f"Model: {usage['model']}{fallback_note} — {usage['input_tokens']} in / "
            f"{usage['output_tokens']} out (~{kitchen_cost})"
        )
        if usage["truncated"]:
            print(
                "WARNING: hit max_tokens — the bases list below may be missing real bases, "
                "not a correct 'none found'."
            )

    bases = result["bases"]
    print(f"\n{len(bases)} base(s) found:")
    for base in bases:
        ingredients = ", ".join(
            f"{i['name']} {i['qty']:g}{i['unit']}" for i in base["batch_ingredients"]
        )
        print(
            f"\n- {base['name']} ({base.get('type', '')}, {base['source']}, "
            f"confidence {base['confidence']:.2f}, yield {base['yield_qty']:g})"
        )
        print(f"  formula: {ingredients}")
        print(f"  reason: {base.get('reason', '')}")
        print(f"  used by {len(base['used_by'])} dishes:")
        for use in base["used_by"][:15]:
            print(f"    - {use['dish']}: {use['grams_per_portion']:g} g/ml per portion")
        if len(base["used_by"]) > 15:
            print(f"    ... and {len(base['used_by']) - 15} more")
        if base.get("flags"):
            print(f"  FLAGS: {'; '.join(base['flags'])}")

    total_cost = menu_cost
    if usage is not None:
        total_cost = _cost(
            outcome.total_input_tokens + usage["input_tokens"],
            outcome.total_output_tokens + usage["output_tokens"],
        )
    print(f"\nTotal cost (menu read + base discovery): ~{total_cost}")


if __name__ == "__main__":
    main()
