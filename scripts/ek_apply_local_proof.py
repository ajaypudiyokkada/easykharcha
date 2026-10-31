#!/usr/bin/env python
"""Step EK-4b local proof (no AI spend) — direct ORM, no HTTP, no new AI calls. Takes the most
recent real (AI_FAKE=false) "done" EkSetupRun already sitting in the local dev DB from an earlier
EK-4a real-menu run (scripts/ai_try_ek_setup.py against a real menu, e.g. kavan.pdf), builds the
"default" owner payload from its own GET result (every best-seller's whole family pre-ticked, every
base kept), applies it, and prints what was created. Then applies the same payload again to show
idempotency (ek_apply.apply_ek_setup's own ek_key lookups: nothing new the second time).

Usage (PowerShell, repo root, venv active):
    python scripts/ek_apply_local_proof.py [--run-id N]
"""

import argparse
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

_QTY_UNIT = re.compile(r"^\s*([\d.]+)\s*(\S+)\s*$")


def _base_units(qty_str: str, unit: str) -> float:
    value = float(qty_str)
    return value * 1000 if unit in ("kg", "L") else value


def _base_units_from_combined(display: str) -> float:
    match = _QTY_UNIT.match(display)
    if not match:
        return 0.0
    return _base_units(match.group(1), match.group(2))


def build_default_payload(result: dict) -> tuple[dict, list[str]]:
    """The screen's own default: every ingredient create/link as the result already proposes, every
    base kept, every family containing a best seller pre-ticked. Returns (payload, warnings) — a
    warning for any formula/base-use name this script couldn't map back to an ingredient/base key
    (a real menu's canonicalisation can occasionally rename a base-template ingredient slightly
    differently from its family-recipe sibling; the mobile screen does this same name lookup off the
    same two lists, so a miss here would miss there too)."""
    warnings: list[str] = []
    name_to_ingredient_key = {ing["name"].lower(): ing["key"] for ing in result["ingredients"]}
    name_to_base_key = {base["name"].lower(): base["key"] for base in result["bases"]}

    ingredients_payload = [
        {
            "key": ing["key"],
            "create": ing["matched_item_id"] is None,
            "existing_item_id": ing["matched_item_id"],
            "name": ing["name"],
            "unit_family": ing["unit_family"],
            "low_stock_category": ing["low_stock_category"],
        }
        for ing in result["ingredients"]
    ]

    bases_payload = []
    for base in result["bases"]:
        formula = []
        for line in base["per_1000_formula"]:
            key = name_to_ingredient_key.get(line["name"].lower())
            if key is None:
                warnings.append(f"base '{base['name']}': no ingredient key for '{line['name']}'")
                continue
            formula.append(
                {
                    "ingredient_key": key,
                    "qty_base_units": _base_units(line["display_qty"], line["display_unit"]),
                }
            )
        bases_payload.append(
            {
                "key": base["key"],
                "keep": True,
                "name": base["name"],
                "formula": formula,
                "dish_ids": [d["dish_id"] for d in base["dishes"] if d["dish_id"] is not None],
            }
        )

    best_seller_dish_ids = {p["dish_id"] for p in result["best_sellers"] if p["dish_id"] is not None}

    recipes_payload = []
    for family in result["families"]:
        family_dish_ids = {m["dish_id"] for m in family["members"] if m["dish_id"] is not None}
        selected = bool(family_dish_ids & best_seller_dish_ids)

        others = []
        for ing in family["other_ingredients"]:
            key = name_to_ingredient_key.get(ing["name"].lower())
            if key is None:
                warnings.append(f"family '{family['name']}': no ingredient key for '{ing['name']}'")
                continue
            others.append(
                {"ingredient_key": key, "qty": _base_units(ing["display_qty"], ing["display_unit"])}
            )

        bases_used = []
        for use in family["bases_used"]:
            key = name_to_base_key.get(use["base"].lower())
            if key is None:
                warnings.append(f"family '{family['name']}': no base key for '{use['base']}'")
                continue
            bases_used.append(
                {"base_key": key, "qty_per_portion": _base_units_from_combined(use["portion_display"])}
            )

        for member in family["members"]:
            if member["dish_id"] is None:
                continue
            main = None
            if member["main_item"] and member["qty_display"]:
                main_key = name_to_ingredient_key.get(member["main_item"].lower())
                if main_key is None:
                    warnings.append(f"dish '{member['name']}': no ingredient key for main item")
                else:
                    main = {
                        "ingredient_key": main_key,
                        "qty": _base_units_from_combined(member["qty_display"]),
                    }
            recipes_payload.append(
                {
                    "dish_id": member["dish_id"],
                    "selected": selected,
                    "main": main,
                    "others": others,
                    "bases": bases_used,
                }
            )

    return (
        {"ingredients": ingredients_payload, "bases": bases_payload, "recipes": recipes_payload},
        warnings,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", type=int, default=None)
    args = parser.parse_args()

    backend_dir = os.path.join(os.path.dirname(__file__), "..", "backend")
    sys.path.insert(0, os.path.abspath(backend_dir))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    os.environ.setdefault("AI_FAKE", "true")
    import django

    django.setup()

    from ai.ek_apply import apply_ek_setup
    from ai.models import EkSetupRun, EkSetupRunStatus
    from stock.base_expansion import quantity_per_portion_by_sell_item
    from stock.models import StockItem

    if args.run_id:
        run = EkSetupRun.objects.get(id=args.run_id)
    else:
        run = (
            EkSetupRun.objects.filter(status=EkSetupRunStatus.DONE)
            .exclude(result__isnull=True)
            .order_by("-id")
            .first()
        )
    if run is None:
        print("FAILED: no done EkSetupRun in the local DB — run scripts/ai_try_ek_setup.py first.")
        sys.exit(1)

    business = run.business
    owner_access = business.access.filter(role="owner").first()
    owner = owner_access.user if owner_access else business.access.first().user
    print(f"Using EkSetupRun {run.id} — business {business.id} ({business.name}).")

    payload, warnings = build_default_payload(run.result)
    if warnings:
        print(f"\n{len(warnings)} name-lookup warning(s) building the default payload:")
        for w in warnings[:10]:
            print(f"  - {w}")

    result = apply_ek_setup(run, payload, owner)

    print("\n--- APPLY RESULT (first call) ---")
    print(
        f"created_items={result['created_items']} linked_items={result['linked_items']} "
        f"created_bases={result['created_bases']} recipes_applied={result['recipes_applied']} "
        f"skipped={result['skipped_count']}"
    )
    print(f"recipe_coverage_pct={result['recipe_coverage_pct']}")
    print("\ncreated stock items (first 15):")
    for item in result["stock_items"][:15]:
        print(f"  {item}")
    print(f"\nskipped (first 15 of {len(result['skipped'])}):")
    for row in result["skipped"][:15]:
        print(f"  {row}")

    chicken_curry = business.sell_items.filter(name__icontains="chicken curry").first()
    print("\n--- Chicken Curry expected usage (if present on this business) ---")
    if chicken_curry is None:
        print("  no 'Chicken Curry' dish on this business — nothing to compare against the")
        print("  regression scenario (that scenario is exercised by scripts/smoke.py instead).")
    else:
        for stock_item in StockItem.objects.filter(business=business):
            per_portion = quantity_per_portion_by_sell_item(business, stock_item).get(chicken_curry)
            if per_portion:
                print(f"  {stock_item.name}: {per_portion} {stock_item.unit}/portion x10 = {per_portion * 10}")

    before_counts = (
        StockItem.objects.filter(business=business).count(),
        business.bases.count(),
    )
    result2 = apply_ek_setup(run, payload, owner)
    after_counts = (
        StockItem.objects.filter(business=business).count(),
        business.bases.count(),
    )
    print("\n--- APPLY RESULT (second call — idempotency check) ---")
    print(f"created_items={result2['created_items']} created_bases={result2['created_bases']}")
    if before_counts == after_counts and result2["created_items"] == 0 and result2["created_bases"] == 0:
        print(f"OK — nothing new created on the second apply (stock items/bases: {after_counts}).")
    else:
        print(f"MISMATCH — before {before_counts}, after {after_counts}")


if __name__ == "__main__":
    main()
