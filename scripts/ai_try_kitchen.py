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

from ai.base_discovery import apply_groups, discover_bases, expand_dish_options  # noqa: E402
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


# Step EK-2b measurement only (not production logic) — a dish name that's just one of these generic
# style/heading words on its own is almost certainly a leftover bare heading, not a real dish.
_LIKELY_BARE_HEADING_WORDS = {
    "manchurian",
    "chilli",
    "chili",
    "pepper",
    "schezwan",
    "sichuan",
    "chutney",
    "masala",
    "gravy",
    "roast",
    "dry",
    "noodles",
    "soup",
    "65",
    "lollipop",
}


def _bare_heading_dishes(dishes: list[dict]) -> list[str]:
    return [d["name"] for d in dishes if d["name"].strip().lower() in _LIKELY_BARE_HEADING_WORDS]


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
        files,
        args.business_type,
        extract_fn=anthropic_provider.extract_menu,
        extract_groups_fn=anthropic_provider.extract_menu_groups,
    )
    menu_cost = _cost(outcome.total_input_tokens, outcome.total_output_tokens)
    print(
        f"Menu extraction: {outcome.total_input_tokens} in / {outcome.total_output_tokens} out "
        f"(~{menu_cost}), {len(outcome.calls)} call(s)"
    )
    print(f"Groups found (dedicated pass): {len(outcome.groups)}")
    for group in outcome.groups:
        print(f"  - {group['heading']!r} + {group['choices']} ({group['position']})")
    if not outcome.merged["is_menu"]:
        print("is_menu: false — stopping, nothing to discover bases for.")
        return

    raw_dishes = [
        {"name": dish["name"], "variants": dish.get("variants") or []}
        for section in outcome.merged["sections"]
        for dish in section["dishes"]
        if dish.get("kind", "dish") != "addon"
    ]
    print(f"\n{len(raw_dishes)} dishes (addons excluded) before option expansion")

    expanded = expand_dish_options(raw_dishes)
    expanded = apply_groups(expanded, outcome.groups)
    expanded_count = sum(1 for d in expanded if "expanded_from" in d)
    print(
        f"{len(expanded)} dishes after option expansion + group pass "
        f"({expanded_count} came from an expanded line)"
    )
    for dish in expanded:
        if "expanded_from" in dish:
            print(f"  - {dish['expanded_from']!r} -> {dish['name']!r}")

    bare = _bare_heading_dishes(expanded)
    print(f"\nDISH COUNT: {len(expanded)}")
    print(f"BARE HEADING DISHES: {len(bare)} {bare}")

    print(f"\nClassifying dishes and mapping bases ({settings.AI_MODEL_KITCHEN})...")
    result = discover_bases(
        expanded, args.business_type, [], classify_fn=anthropic_provider.classify_dishes
    )
    usage = result["usage"]
    kitchen_input = sum(u["input_tokens"] for u in usage)
    kitchen_output = sum(u["output_tokens"] for u in usage)
    if not usage:
        print("(cache hit — no model call made)")
    else:
        for call in usage:
            fallback_note = " [fallback model]" if call["used_fallback"] else ""
            print(
                f"  batch: {call['model']}{fallback_note} — {call['input_tokens']} in / "
                f"{call['output_tokens']} out"
            )
        print(f"Classification total: {kitchen_input} in / {kitchen_output} out (~{_cost(kitchen_input, kitchen_output)})")

    bases = result["bases"]
    print(f"\n{len(bases)} base(s) found:")
    for base in bases:
        ingredients = ", ".join(
            f"{i['name']} {i['qty']:g}{i['unit']}" for i in base["batch_ingredients"]
        )
        by_family: dict[str, int] = {}
        for use in base["used_by"]:
            by_family[use.get("family", "")] = by_family.get(use.get("family", ""), 0) + 1
        family_summary = ", ".join(f"{fam or '(none)'}: {n}" for fam, n in sorted(by_family.items()))
        print(
            f"\n- {base['name']} ({base.get('type', '')}, {base['source']}, "
            f"confidence {base['confidence']:.2f}, yield {base['yield_qty']:g})"
        )
        print(f"  formula: {ingredients}")
        print(f"  reason: {base.get('reason', '')}")
        print(f"  used by {len(base['used_by'])} dishes — by family: {family_summary}")
        for use in base["used_by"][:15]:
            print(f"    - {use['dish']}: {use['grams_per_portion']:g} g/ml per portion ({use.get('family', '')})")
        if len(base["used_by"]) > 15:
            print(f"    ... and {len(base['used_by']) - 15} more")
        if base.get("flags"):
            print(f"  FLAGS: {'; '.join(base['flags'])}")

    total_cost = _cost(
        outcome.total_input_tokens + kitchen_input, outcome.total_output_tokens + kitchen_output
    )
    print(f"\nTotal cost (menu read + classification): ~{total_cost}")


if __name__ == "__main__":
    main()
