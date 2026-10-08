"""Creating a tenant, and copying a starter catalogue into it."""

from django.db import transaction

from accounts.models import Access
from audit.services import log
from core.roles import OWNER
from inventory.models import Dish, Ingredient, Vendor
from tenants.models import Business


@transaction.atomic
def create_business(access, data: dict, seed_from: Business | None = None) -> Business:
    business = Business.objects.create(**data)

    # Whoever creates a tenant owns it — unless they are a global Super Admin, who already reaches
    # every tenant and does not need (or want) a per-tenant row cluttering the staff list.
    if not access.is_super_admin:
        Access.objects.create(business=business, user=access.user, role=OWNER, active=True)

    log(
        access,
        "business.create",
        summary=f"Created {business.name}",
        detail={"name": business.name, "seeded_from": seed_from.name if seed_from else None},
        business=business,
    )
    if seed_from is not None:
        copy_catalogue(seed_from, business)
    return business


@transaction.atomic
def copy_catalogue(source: Business, target: Business) -> dict:
    """Copy vendors, ingredients and dishes. Entries (stock, sales, purchases) are never copied."""
    vendor_map = {}
    for vendor in Vendor.objects.filter(business=source):
        copy = Vendor.objects.create(
            business=target,
            code=vendor.code,
            name=vendor.name,
            category=vendor.category,
            terms=vendor.terms,
        )
        vendor_map[vendor.id] = copy

    ingredient_map = {}
    for ingredient in Ingredient.objects.filter(business=source):
        copy = Ingredient.objects.create(
            business=target,
            code=ingredient.code,
            name=ingredient.name,
            category=ingredient.category,
            unit=ingredient.unit,
            rate=ingredient.rate,
            vendor=vendor_map.get(ingredient.vendor_id),
            target_pct=ingredient.target_pct,
            waste_alert_pct=ingredient.waste_alert_pct,
            shared=ingredient.shared,
            track=ingredient.track,
            canonical=ingredient.canonical,
            piece_weight_g=ingredient.piece_weight_g,
            recipe_unit=ingredient.recipe_unit,
            recipe_units_per_stock_unit=ingredient.recipe_units_per_stock_unit,
            yield_pct=ingredient.yield_pct,
            variance_alert_pct=ingredient.variance_alert_pct,
        )
        ingredient_map[ingredient.id] = copy

    dish_count = 0
    for dish in Dish.objects.filter(business=source):
        primary = ingredient_map.get(dish.ing_id)
        if primary is None:
            continue
        Dish.objects.create(
            business=target,
            code=dish.code,
            name=dish.name,
            section=dish.section,
            # Price is deliberately NOT copied: another restaurant's prices are not this one's, and a
            # plausible-looking wrong price corrupts every cost% from day one.
            price=0,
            ing=primary,
            active=dish.active,
            notes=dish.notes,
        )
        dish_count += 1

    return {
        "vendors": len(vendor_map),
        "ingredients": len(ingredient_map),
        "dishes": dish_count,
    }
