"""Step EK-4b: turns the owner's confirmed choices on the EK setup screens (built from
ek_setup.build_owner_result, edited/confirmed by the owner) into real StockItem/Base/SellItem rows,
in one atomic call. Nothing here calls the AI provider. EkSetupApplyView is the only caller.

Create-only-what's-used (rule A of the step brief): an ingredient is only ever created/linked if a
kept, dish-linked base's formula or a selected, creatable recipe actually uses it; a base is only
ever created if a recipe being created in this same call links to it (a base with no recipe would
give wrong expected usage, see base_expansion.py). `ek_key` (StockItem/Base/SellItem) marks a row
this function created, scoped to this one run, so a repeated call for the same run recognises its
own earlier work instead of duplicating it (rule D) — a plain retry creates nothing new; a dish
still UNCONFIRMED gets its rows replaced (never a dish the owner already confirmed, rule C)."""

from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from audit.log import log_action
from reports.service import _recipe_coverage_pct
from stock.models import (
    Base,
    BaseIngredient,
    LowStockCategory,
    RecipeStatus,
    SellItem,
    SellItemBase,
    SellItemIngredient,
    StockItem,
    Unit,
)
from stock.units import UnitFamily
from stock.units import unit_family as stock_unit_family

from .exceptions import EkApplyInvalid

# ai.matching.unit_family's own vocabulary (g/ml/pieces) — what a "new" ingredient's unit_family
# arrives as in the payload, same as ek_setup.build_owner_result's own ingredient rows.
_UNIT_FOR_PAYLOAD_FAMILY = {"g": Unit.G, "ml": Unit.ML, "pieces": Unit.PIECE}


def _bad(message: str):
    raise EkApplyInvalid(message)


def _quantity(value, field: str) -> Decimal:
    try:
        quantity = Decimal(str(value))
    except (InvalidOperation, TypeError):
        _bad(f"'{field}' must be a number.")
    if quantity <= 0:
        _bad(f"'{field}' must be greater than zero.")
    return quantity


def _low_stock_category(value) -> str:
    return value if value in LowStockCategory.values else LowStockCategory.DRY_STAPLES


def apply_ek_setup(run, payload: dict, user) -> dict:
    """payload is the owner's final choices, shaped as described in the step brief (ingredients/
    bases/recipes). Returns the response body: counts, created stock items, skipped list, recipe
    coverage. Raises ValidationError (400) for a structurally broken payload (a bad key reference)
    — never for stale state, which is reported in `skipped` instead."""
    business = run.business

    ingredients_by_key = {row["key"]: row for row in payload.get("ingredients") or []}
    bases_by_key = {row["key"]: row for row in payload.get("bases") or []}
    recipes_payload = payload.get("recipes") or []

    skipped: list[dict] = []

    # --- 1. Selected recipes whose dish still exists and isn't already confirmed ---
    selected = [row for row in recipes_payload if row.get("selected")]
    dish_ids = [row["dish_id"] for row in selected]
    dishes_by_id = {d.id: d for d in business.sell_items.filter(id__in=dish_ids)}
    creatable_recipes: list[tuple[SellItem, dict]] = []
    for row in selected:
        dish = dishes_by_id.get(row["dish_id"])
        if dish is None or not dish.active:
            skipped.append({"type": "recipe", "dish_id": row["dish_id"], "reason": "dish_deleted"})
            continue
        if dish.recipe_status == RecipeStatus.CONFIRMED:
            skipped.append(
                {
                    "type": "recipe",
                    "dish_id": row["dish_id"],
                    "name": dish.name,
                    "reason": "already_confirmed",
                }
            )
            continue
        creatable_recipes.append((dish, row))

    # --- 2. Bases actually linked to one of those recipes (rule B) ---
    base_uses: dict[str, list[tuple[SellItem, object]]] = {}
    for dish, row in creatable_recipes:
        for link in row.get("bases") or []:
            base_uses.setdefault(link["base_key"], []).append((dish, link["qty_per_portion"]))

    bases_to_create = []
    for key, row in bases_by_key.items():
        if not row.get("keep"):
            skipped.append(
                {"type": "base", "key": key, "name": row.get("name", ""), "reason": "removed"}
            )
            continue
        if key not in base_uses:
            skipped.append(
                {"type": "base", "key": key, "name": row.get("name", ""), "reason": "not_linked"}
            )
            continue
        bases_to_create.append(row)

    # --- 3. Ingredients actually used by a creatable base or recipe (rule A) ---
    used_ingredient_keys: set[str] = set()
    for base_row in bases_to_create:
        for formula_line in base_row.get("formula") or []:
            used_ingredient_keys.add(formula_line["ingredient_key"])
    for _dish, row in creatable_recipes:
        main = row.get("main")
        if main:
            used_ingredient_keys.add(main["ingredient_key"])
        for other in row.get("others") or []:
            used_ingredient_keys.add(other["ingredient_key"])

    for key, row in ingredients_by_key.items():
        if key not in used_ingredient_keys:
            skipped.append(
                {
                    "type": "ingredient",
                    "key": key,
                    "name": row.get("name", ""),
                    "reason": "not_used",
                }
            )

    with transaction.atomic():
        stock_item_by_key: dict[str, StockItem] = {}
        created_items: list[StockItem] = []
        linked_count = 0

        # Payload order, not the set's arbitrary one — so "stock_items" in the response (rule G's
        # "first 15") lines up with the order the owner saw them in on the setup screen.
        for key in used_ingredient_keys:
            if key not in ingredients_by_key:
                _bad(f"Unknown ingredient key: {key}")
        for key in (k for k in ingredients_by_key if k in used_ingredient_keys):
            row = ingredients_by_key[key]
            if not row.get("create"):
                existing_id = row.get("existing_item_id")
                item = business.stock_items.filter(id=existing_id).first() if existing_id else None
                if item is None:
                    _bad(f"Ingredient '{key}': existing_item_id not found on this business.")
                stock_item_by_key[key] = item
                linked_count += 1
                continue

            ek_key = f"ek:{run.id}:ing:{key}"
            item = business.stock_items.filter(ek_key=ek_key).first()
            if item is None:
                unit = _UNIT_FOR_PAYLOAD_FAMILY.get(row.get("unit_family"), Unit.PIECE)
                pack_size = row.get("pack_size_base_qty")
                item = StockItem.objects.create(
                    business=business,
                    name=row["name"],
                    unit=unit,
                    unit_family=stock_unit_family(unit),
                    low_stock_category=_low_stock_category(row.get("low_stock_category")),
                    pack_size_base_qty=Decimal(str(pack_size)) if pack_size else None,
                    created_by=user,
                    ek_key=ek_key,
                )
                created_items.append(item)
            stock_item_by_key[key] = item

        base_by_key: dict[str, Base] = {}
        created_bases: list[Base] = []
        for base_row in bases_to_create:
            key = base_row["key"]
            ek_key = f"ek:{run.id}:base:{key}"
            base = Base.objects.filter(business=business, ek_key=ek_key).first()
            if base is None:
                base = Base.objects.create(
                    business=business,
                    name=base_row["name"],
                    unit_family=UnitFamily.WEIGHT,
                    created_by=user,
                    ek_key=ek_key,
                )
                created_bases.append(base)
            base_by_key[key] = base
            base.ingredients.all().delete()
            BaseIngredient.objects.bulk_create(
                BaseIngredient(
                    base=base,
                    stock_item=stock_item_by_key[formula_line["ingredient_key"]],
                    quantity_per_1000=_quantity(formula_line["qty_base_units"], "formula qty"),
                )
                for formula_line in base_row.get("formula") or []
            )

        recipe_count = 0
        for dish, row in creatable_recipes:
            ingredient_rows = []
            main = row.get("main")
            if main:
                ingredient_rows.append(
                    (stock_item_by_key[main["ingredient_key"]], _quantity(main["qty"], "main qty"))
                )
            for other in row.get("others") or []:
                ingredient_rows.append(
                    (stock_item_by_key[other["ingredient_key"]], _quantity(other["qty"], "qty"))
                )

            base_rows = []
            for link in row.get("bases") or []:
                base = base_by_key.get(link["base_key"])
                if base is None:
                    continue
                base_rows.append((base, _quantity(link["qty_per_portion"], "base qty")))

            if not ingredient_rows and not base_rows:
                skipped.append(
                    {
                        "type": "recipe",
                        "dish_id": dish.id,
                        "name": dish.name,
                        "reason": "no_ingredients",
                    }
                )
                continue

            dish.ingredients.all().delete()
            SellItemIngredient.objects.bulk_create(
                SellItemIngredient(sell_item=dish, stock_item=stock_item, quantity=quantity)
                for stock_item, quantity in ingredient_rows
            )
            dish.bases.all().delete()
            SellItemBase.objects.bulk_create(
                SellItemBase(sell_item=dish, base=base, quantity=quantity)
                for base, quantity in base_rows
            )
            dish.recipe_status = RecipeStatus.UNCONFIRMED
            dish.ek_key = f"ek:{run.id}:recipe:{dish.id}"
            dish.save(update_fields=["recipe_status", "ek_key"])
            recipe_count += 1

        if run.applied_at is None:
            run.applied_at = timezone.now()
            run.applied_by = user
            run.save(update_fields=["applied_at", "applied_by"])

        log_action(
            user=user,
            action="ek_setup.apply",
            business=business,
            run_id=run.id,
            created_items=len(created_items),
            linked_items=linked_count,
            created_bases=len(created_bases),
            recipes_applied=recipe_count,
            skipped=len(skipped),
        )

    today = timezone.now().date()
    coverage_pct = _recipe_coverage_pct(business, today - timedelta(days=365), today)

    return {
        "created_items": len(created_items),
        "linked_items": linked_count,
        "created_bases": len(created_bases),
        "recipes_applied": recipe_count,
        "skipped_count": len(skipped),
        "stock_items": [
            {
                "id": item.id,
                "name": item.name,
                "unit_family": item.unit_family,
                "display_unit": item.unit,
            }
            for item in created_items
        ],
        "skipped": skipped,
        "recipe_coverage_pct": coverage_pct,
    }
