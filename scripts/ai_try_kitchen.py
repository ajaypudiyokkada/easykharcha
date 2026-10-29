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

from ai.base_discovery import (  # noqa: E402
    _dedup_key,
    apply_groups,
    discover_bases,
    expand_dish_options,
)
from ai.classification import classify_dishes  # noqa: E402
from ai.extraction import run_menu_extraction  # noqa: E402
from ai.provider import anthropic_provider  # noqa: E402
from ai.recipe_composer import (  # noqa: E402
    MAX_FAMILIES_PER_MENU,
    build_families,
    compose_family_recipes,
    pick_best_sellers,
    resolve_ingredients,
)
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
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("menu_file", type=Path, help="Path to one menu image or PDF")
    parser.add_argument(
        "--type", dest="business_type", required=True, choices=[c.value for c in BusinessType]
    )
    parser.add_argument(
        "--setup",
        action="store_true",
        help="Step EK-3: also run recipe_composer.suggest_setup (best sellers, family recipes, ingredient resolution) after base discovery.",
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
        dish_names = [d["name"] for d in group["dishes"]]
        print(f"  - {group['heading']!r} -> {dish_names}")
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
    seen_keys: dict[str, str] = {}
    duplicate_names = []
    for dish in expanded:
        key = _dedup_key(dish["name"])
        if key in seen_keys:
            duplicate_names.append((seen_keys[key], dish["name"]))
        else:
            seen_keys[key] = dish["name"]
    print(f"\nDISH COUNT: {len(expanded)}")
    print(f"BARE HEADING DISHES: {len(bare)} {bare}")
    print(
        f"DUPLICATE NAMES (after token-sort normalisation): {len(duplicate_names)} {duplicate_names}"
    )

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
        print(
            f"Classification total: {kitchen_input} in / {kitchen_output} out (~{_cost(kitchen_input, kitchen_output)})"
        )

    bases = result["bases"]
    print(f"\n{len(bases)} base(s) found:")
    for base in bases:
        ingredients = ", ".join(
            f"{i['name']} {i['qty']:g}{i['unit']}" for i in base["batch_ingredients"]
        )
        by_family: dict[str, int] = {}
        for use in base["used_by"]:
            by_family[use.get("family", "")] = by_family.get(use.get("family", ""), 0) + 1
        family_summary = ", ".join(
            f"{fam or '(none)'}: {n}" for fam, n in sorted(by_family.items())
        )
        print(
            f"\n- {base['name']} ({base.get('type', '')}, {base['source']}, "
            f"confidence {base['confidence']:.2f}, yield {base['yield_qty']:g})"
        )
        print(f"  formula: {ingredients}")
        print(f"  reason: {base.get('reason', '')}")
        print(f"  used by {len(base['used_by'])} dishes — by family: {family_summary}")
        for use in base["used_by"][:15]:
            print(
                f"    - {use['dish']}: {use['grams_per_portion']:g} g/ml per portion ({use.get('family', '')})"
            )
        if len(base["used_by"]) > 15:
            print(f"    ... and {len(base['used_by']) - 15} more")
        if base.get("flags"):
            print(f"  FLAGS: {'; '.join(base['flags'])}")

    total_cost = _cost(
        outcome.total_input_tokens + kitchen_input, outcome.total_output_tokens + kitchen_output
    )
    print(f"\nTotal cost (menu read + classification): ~{total_cost}")

    if not args.setup:
        return

    print("\n" + "=" * 70)
    print("STEP EK-3: suggest_setup (best sellers, family recipes, ingredients)")
    print("=" * 70)

    classifications, _classify_usage = classify_dishes(
        expanded, args.business_type, classify_fn=anthropic_provider.classify_dishes
    )

    best_sellers_data = pick_best_sellers(
        expanded, classifications, args.business_type, pick_fn=anthropic_provider.pick_best_sellers
    )
    best_sellers = best_sellers_data["best_sellers"]
    bs_categories = {p["category"] for p in best_sellers}
    print(
        f"\nBEST SELLERS ({len(best_sellers)}, {len(bs_categories)} categories: {sorted(bs_categories)}):"
    )
    for p in best_sellers:
        print(f"  - {p['name']} ({p['category']}) — {p['reason']}")

    families = build_families(expanded, classifications)
    print(
        f"\n{len(families)} raw families built from {len(expanded)} dishes "
        f"(before the {MAX_FAMILIES_PER_MENU}-family cap)"
    )

    family_data = compose_family_recipes(
        families,
        bases,
        args.business_type,
        [],
        compose_fn=anthropic_provider.compose_family_recipe,
    )
    family_results = family_data["families"]
    family_usage = family_data["usage"]
    family_input = sum(u["input_tokens"] for u in family_usage)
    family_output = sum(u["output_tokens"] for u in family_usage)
    print(
        f"Family recipe calls: {len(family_usage)} (of {len(family_results)} families — rest were "
        f"cache hits), {family_input} in / {family_output} out (~{_cost(family_input, family_output)})"
    )

    corrections = [(f["name"], c) for f in family_results for c in f["corrections"]]
    all_flags = [(f["name"], flag) for f in family_results for flag in f.get("flags", [])]

    print(f"\nALL {len(family_results)} FAMILIES (name — member count):")
    for family in family_results:
        print(f"  - {family['name']} ({len(family['dishes'])} members)")

    print(f"\n3 SAMPLE FAMILY RECIPES (of {len(family_results)}):")
    for family in family_results[:3]:
        print(f"\n- {family['name']} ({len(family['dishes'])} dishes: {family['dishes']})")
        print(f"  portion: {family['portion_label']!r}")
        members_line = ", ".join(
            f"{m['dish_name']}={m['qty']:g}{m['main_item_unit']} {m['main_item_name']}".strip()
            if m["main_item_name"]
            else f"{m['dish_name']}=(no main item)"
            for m in family["members"]
        )
        print(f"  members: {members_line}")
        if family["bases_used"]:
            bases_line = ", ".join(
                f"{b['base']} {b['grams_per_portion']:g}g" for b in family["bases_used"]
            )
            print(f"  bases used: {bases_line}")
        ingredients_line = ", ".join(
            f"{i['name']} {i['amount']:g}{i['unit']}" for i in family["ingredients"]
        )
        print(f"  ingredients: {ingredients_line or '(none)'}")
        minor_line = ", ".join(
            f"{i['name']} {i['amount']:g}{i['unit']}" for i in family["minor_ingredients"]
        )
        print(f"  minor ingredients: {minor_line or '(none)'}")

    # The Coffee/drinks family (or families) and the Pepper family — called out explicitly per the
    # EK-3b real-run proof's required sections.
    drink_families = [f for f in family_results if "coffee" in f["name"].lower() or "drink" in f["name"].lower()]
    print(f"\nCOFFEE/DRINKS FAMILIES ({len(drink_families)}):")
    for family in drink_families:
        print(f"  - {family['name']}: {family['dishes']}")

    pepper_families = [f for f in family_results if "pepper" in f["name"].lower()]
    print(f"\nPEPPER FAMILY ({len(pepper_families)} found):")
    for family in pepper_families:
        print(f"  - {family['name']}:")
        for m in family["members"]:
            item = f"{m['qty']:g}{m['main_item_unit']} {m['main_item_name']}" if m["main_item_name"] else "(no main item)"
            print(f"      {m['dish_name']}: {item}")

    ingredients = resolve_ingredients(family_results, bases, sector=args.business_type)
    distinct_count = ingredients["matched_count"] + ingredients["new_count"]
    print(
        f"\nINGREDIENTS: {distinct_count} distinct ({ingredients['matched_count']} matched to "
        f"existing stock, {ingredients['new_count']} new) — FULL LIST:"
    )
    all_names = [m["stock_item_name"] for m in ingredients["matched"]] + [
        n["name"] for n in ingredients["new"]
    ]
    duplicate_names = {name for name in all_names if all_names.count(name) > 1}
    for n in ingredients["new"]:
        print(
            f"  new: {n['name']} ({n['unit_family']}, {n['low_stock_category']}) — "
            f"used in {len(n['used_in'])}: {n['used_in'][:3]}{'...' if len(n['used_in']) > 3 else ''}"
        )
    for m in ingredients["matched"]:
        print(f"  matched: {m['stock_item_name']} (from '{m['matched_from']}') — used in {len(m['used_in'])}")

    if corrections:
        print(f"\nQUANTITY CORRECTIONS ({len(corrections)}):")
        for family_name, note in corrections:
            print(f"  - [{family_name}] {note}")
    else:
        print("\nQUANTITY CORRECTIONS: none")

    if all_flags:
        print(f"\nFLAGS / CHECK-THIS ({len(all_flags)}):")
        for family_name, flag in all_flags:
            print(f"  - [{family_name}] {flag}")
    else:
        print("\nFLAGS / CHECK-THIS: none")

    setup_input = (
        kitchen_input + sum(u["input_tokens"] for u in best_sellers_data["usage"]) + family_input
    )
    setup_output = (
        kitchen_output + sum(u["output_tokens"] for u in best_sellers_data["usage"]) + family_output
    )
    setup_cost_usd = (
        Decimal(setup_input) / Decimal(1_000_000) * settings.AI_PRICE_IN_PER_MTOK
        + Decimal(setup_output) / Decimal(1_000_000) * settings.AI_PRICE_OUT_PER_MTOK
    )
    print(f"Setup-only cost (best sellers + family recipes, no menu read): ~${setup_cost_usd:.4f}")
    full_cost_usd = (
        Decimal(outcome.total_input_tokens + setup_input)
        / Decimal(1_000_000)
        * settings.AI_PRICE_IN_PER_MTOK
        + Decimal(outcome.total_output_tokens + setup_output)
        / Decimal(1_000_000)
        * settings.AI_PRICE_OUT_PER_MTOK
    )
    # Approximate, for a rough Rs comparison only — no live FX lookup.
    inr_rate = Decimal("83")
    full_cost_inr = full_cost_usd * inr_rate
    print(
        f"\nTOTAL COST (menu read + classification + best sellers + family recipes): "
        f"~${full_cost_usd:.4f} (~Rs {full_cost_inr:.2f} at Rs {inr_rate}/USD, approximate)"
    )

    print("\nTARGETS:")
    misses = []
    if not (8 <= len(best_sellers) <= 12):
        misses.append(f"best sellers: got {len(best_sellers)}, target 8-12")
    if len(bs_categories) < 4:
        misses.append(f"best seller categories: got {len(bs_categories)}, target >=4")
    if not (30 <= len(family_results) <= 60):
        misses.append(f"families: got {len(family_results)} (of {len(families)} raw), target 30-60")
    if not (40 <= distinct_count <= 85):
        misses.append(f"distinct ingredients: got {distinct_count}, target 40-85")
    if duplicate_names:
        misses.append(f"duplicate ingredient names: {duplicate_names}")
    if all_flags:
        misses.append(f"protein/veg main-item mismatches flagged (should be 0): {len(all_flags)}")
    if full_cost_inr > 15:
        misses.append(f"cost: ~Rs {full_cost_inr:.2f}, target under Rs 15")
    if misses:
        print("MISSED:")
        for m in misses:
            print(f"  - {m}")
    else:
        print("All targets met.")


if __name__ == "__main__":
    main()
