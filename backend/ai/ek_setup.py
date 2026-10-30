"""Step EK-4a: turns recipe_composer.suggest_setup's internal result into the owner-facing shape
EkSetupDetailView returns, and builds suggest_setup's own dish input from the business's current
(confirmed, edited, un-deleted) sell items — see EkSetupRun's docstring for why that's the input
instead of re-reading the original scan. Nothing here calls the AI provider or touches the
database beyond reading SellItem/StockItem rows; ai/jobs.py's process_ek_setup_run is the only
caller."""

import re
from decimal import Decimal

from stock.units import display_quantity

from .matching import normalise, unit_family
from .models import EkSetupRun

_SLUG_NON_WORD = re.compile(r"[^a-z0-9]+")


def _slugify(text: str, used: set[str]) -> str:
    base = _SLUG_NON_WORD.sub("-", text.lower()).strip("-") or "item"
    slug = base
    suffix = 2
    while slug in used:
        slug = f"{base}-{suffix}"
        suffix += 1
    used.add(slug)
    return slug


def build_dish_input(business) -> tuple[list[dict], dict[str, int]]:
    """The owner's confirmed dish list: every active SellItem on this business right now — a
    deleted dish was never created or is deactivated, so it's already absent; an edited dish shows
    its current (edited) name. Returns (dishes for suggest_setup, dish_id by normalised name)."""
    rows = business.sell_items.filter(active=True).values_list("id", "name")
    dish_id_by_norm = {normalise(name): dish_id for dish_id, name in rows}
    dishes = [{"name": name} for _dish_id, name in rows]
    return dishes, dish_id_by_norm


def _display(qty, unit: str) -> dict:
    display_qty, display_unit = display_quantity(Decimal(str(qty)), unit)
    return {"display_qty": str(display_qty), "display_unit": display_unit}


def _dish_ref(name: str, dish_id_by_norm: dict[str, int]) -> dict:
    return {"dish_id": dish_id_by_norm.get(normalise(name)), "name": name}


def build_owner_result(raw: dict, dish_id_by_norm: dict[str, int], business=None) -> dict:
    """raw is suggest_setup's own return shape. Maps every dish name back to the owner's own
    dish_id, formats every quantity through stock/units.py's shared display helpers, and drops
    anything cost/model/vendor-related — never exposed to the owner. `business` looks a matched
    ingredient's own unit/low-stock category up (ai.matching's g/ml/pieces vocabulary, same as a
    "new" ingredient's own unit_family, not stock/units.py's weight/volume/count one) — optional
    only so this stays easy to call from a script/test with no business in hand."""
    used_keys: set[str] = set()

    matched_stock_info: dict[int, tuple[str, str]] = {}
    matched_ids = [entry["stock_item_id"] for entry in raw["ingredients"]["matched"]]
    if business is not None and matched_ids:
        matched_stock_info = {
            row_id: (unit_family(unit), category)
            for row_id, unit, category in business.stock_items.filter(
                id__in=matched_ids
            ).values_list("id", "unit", "low_stock_category")
        }

    best_sellers = [
        {
            "key": _slugify(pick["name"], used_keys),
            **_dish_ref(pick["name"], dish_id_by_norm),
            "reason": pick.get("reason", ""),
            "preselected": True,
        }
        for pick in raw["best_sellers"]
    ]

    bases = []
    for base in raw["bases"]:
        bases.append(
            {
                "key": _slugify(base["name"], used_keys),
                "name": base["name"],
                "kind": base.get("type", ""),
                "per_1000_formula": [
                    {"name": ing["name"], **_display(ing["qty"], ing["unit"])}
                    for ing in base["batch_ingredients"]
                ],
                "dishes": [
                    {
                        **_dish_ref(use["dish"], dish_id_by_norm),
                        "portion_display": "{display_qty} {display_unit}".format(
                            **_display(use["grams_per_portion"], "g")
                        ),
                    }
                    for use in base["used_by"]
                ],
            }
        )

    families = []
    for family in raw["families"]:
        members = []
        for member in family["members"]:
            qty_display = ""
            if member["main_item_name"] and member["qty"]:
                d = _display(member["qty"], member["main_item_unit"])
                qty_display = f"{d['display_qty']} {d['display_unit']}"
            members.append(
                {
                    **_dish_ref(member["dish_name"], dish_id_by_norm),
                    "main_item": member["main_item_name"],
                    "qty_display": qty_display,
                }
            )
        other_ingredients = [
            {"name": ing["name"], **_display(ing["amount"], ing["unit"])}
            for ing in (family["ingredients"] + family["minor_ingredients"])
        ]
        families.append(
            {
                "key": _slugify(family["name"], used_keys),
                "name": family["name"],
                "members": members,
                "bases_used": [
                    {
                        "base": use["base"],
                        "portion_display": "{display_qty} {display_unit}".format(
                            **_display(use["grams_per_portion"], "g")
                        ),
                    }
                    for use in family["bases_used"]
                ],
                "other_ingredients": other_ingredients,
            }
        )

    ingredients = []
    for entry in raw["ingredients"]["matched"]:
        fam, category = matched_stock_info.get(entry["stock_item_id"], ("", ""))
        ingredients.append(
            {
                "key": _slugify(entry["stock_item_name"], used_keys),
                "name": entry["stock_item_name"],
                "unit_family": fam,
                "low_stock_category": category,
                "matched_item_id": entry["stock_item_id"],
                "used_in": entry["used_in"],
            }
        )
    for entry in raw["ingredients"]["new"]:
        ingredients.append(
            {
                "key": _slugify(entry["name"], used_keys),
                "name": entry["name"],
                "unit_family": entry["unit_family"],
                "low_stock_category": entry["low_stock_category"],
                "matched_item_id": None,
                "used_in": entry["used_in"],
            }
        )

    return {
        "best_sellers": best_sellers,
        "bases": bases,
        "families": families,
        "ingredients": ingredients,
        "estimate_note": "Every quantity here is an estimate — check it before you rely on it.",
    }


def save_cost_summary(run: EkSetupRun, cost_summary: dict) -> None:
    run.call_count = cost_summary["calls"]
    run.input_tokens = cost_summary["input_tokens"]
    run.output_tokens = cost_summary["output_tokens"]
    run.est_cost_usd = Decimal(cost_summary["est_cost_usd"])
