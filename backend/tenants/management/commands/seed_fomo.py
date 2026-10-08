"""Seed the FOMO pilot tenant.

**Vendors and ingredients are real** — those rates were supplied in the brief. **Dishes are explicit
placeholders** (₹0, name prefixed "PLACEHOLDER") because the real menu and prices were not available and
inventing prices would corrupt every cost% from day one. See docs/DECISIONS.md D-003.

Replace them with:  python manage.py seed_fomo --replace-dishes --dishes path/to/dishes.csv
"""

import csv
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from inventory.models import Dish, Ingredient, StockUnit, Vendor
from recipes.models import CanonicalIngredient
from tenants.models import Business, BusinessType

VENDORS = [
    ("V-MEAT", "Hilltop Meat Supply", "Meat", "Weekly credit"),
    ("V-FISH", "Coastline Fish Traders", "Fish", "Cash on delivery"),
    ("V-VEG", "Daily Fresh Vegetables", "Vegetables", "Daily, cash"),
    ("V-GROC", "Sunrise Grocery & Provisions", "Groceries", "Monthly credit"),
]

#: (code, name, category, unit, rate, vendor_code, canonical_code, shared, target_pct)
INGREDIENTS = [
    (
        "CHK-CUR",
        "Chicken curry cut",
        "Meat",
        "kg",
        "320",
        "V-MEAT",
        "CHICKEN_CURRY_CUT",
        False,
        None,
    ),
    ("CHK-WNG", "Chicken wings", "Meat", "kg", "310", "V-MEAT", "CHICKEN_WINGS", False, None),
    (
        "CHK-BNL",
        "Chicken boneless (plain)",
        "Meat",
        "kg",
        "360",
        "V-MEAT",
        "CHICKEN_BONELESS",
        False,
        None,
    ),
    (
        "CHK-THG",
        "Chicken thigh boneless",
        "Meat",
        "kg",
        "380",
        "V-MEAT",
        "CHICKEN_THIGH_BONELESS",
        False,
        None,
    ),
    (
        "CHK-BIR",
        "Chicken biryani cut",
        "Meat",
        "kg",
        "330",
        "V-MEAT",
        "CHICKEN_BIRYANI_CUT",
        False,
        None,
    ),
    (
        "CHK-BBQ",
        "Chicken barbecue cut",
        "Meat",
        "kg",
        "340",
        "V-MEAT",
        "CHICKEN_BARBECUE_CUT",
        False,
        None,
    ),
    ("PRK-BNL", "Pork boneless", "Meat", "kg", "340", "V-MEAT", "PORK_BONELESS", False, None),
    ("PRK-RIB", "Pork ribs", "Meat", "kg", "380", "V-MEAT", "PORK_RIBS", False, "35"),
    ("FSH-STK", "Fish steak cut", "Fish", "kg", "300", "V-FISH", "FISH_STEAK", False, "25"),
    ("MTN-KMA", "Mutton kheema", "Meat", "kg", "800", "V-MEAT", "MUTTON_KEEMA", False, None),
    ("OIL-CK", "Cooking oil", "Groceries", "kg", "160", "V-GROC", None, True, None),
]

#: Canonical tags used above. Piece weights are left blank — nobody has weighed FOMO's cuts yet, and a
#: guessed piece weight would silently become a variance alert (§5d).
CANONICALS = [
    ("CHICKEN_CURRY_CUT", "Chicken — curry cut", "Meat"),
    ("CHICKEN_WINGS", "Chicken — wings", "Meat"),
    ("CHICKEN_BONELESS", "Chicken — boneless", "Meat"),
    ("CHICKEN_THIGH_BONELESS", "Chicken — thigh boneless", "Meat"),
    ("CHICKEN_BIRYANI_CUT", "Chicken — biryani cut", "Meat"),
    ("CHICKEN_BARBECUE_CUT", "Chicken — barbecue cut", "Meat"),
    ("PORK_BONELESS", "Pork — boneless", "Meat"),
    ("PORK_RIBS", "Pork — ribs", "Meat"),
    ("FISH_STEAK", "Fish — steak cut", "Fish"),
    ("MUTTON_KEEMA", "Mutton — keema", "Meat"),
    ("PANEER", "Paneer", "Dairy"),
    ("BASMATI_RICE", "Basmati rice", "Grains"),
]

#: Placeholders only. (suffix, section, primary ingredient code)
PLACEHOLDER_DISHES = [
    ("Chilli chicken", "Starters", "CHK-BNL"),
    ("Chicken noodles", "Noodles", "CHK-BNL"),
    ("Chicken soup", "Soups", "CHK-BNL"),
    ("Chicken wings fry", "Starters", "CHK-WNG"),
    ("Chicken curry", "Mains", "CHK-CUR"),
    ("Chicken biryani", "Rice", "CHK-BIR"),
    ("Barbecue chicken", "Starters", "CHK-BBQ"),
    ("Pork ribs", "Starters", "PRK-RIB"),
    ("Pork chilli", "Mains", "PRK-BNL"),
    ("Fish fry", "Starters", "FSH-STK"),
    ("Mutton keema", "Mains", "MTN-KMA"),
]


class Command(BaseCommand):
    help = "Seed the FOMO pilot business with vendors, ingredients and placeholder dishes."

    def add_arguments(self, parser):
        parser.add_argument("--name", default="FOMO")
        parser.add_argument(
            "--replace-dishes",
            action="store_true",
            help="Delete existing dishes before seeding (fails if any have sales).",
        )
        parser.add_argument(
            "--dishes",
            help="CSV of real dishes: code,name,section,price,ingredient_code. Replaces the placeholders.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        business, created = Business.objects.get_or_create(
            name=options["name"],
            defaults={
                "tagline": "Pilot restaurant",
                "business_type": BusinessType.RESTAURANT,
                "primary_colour": "#B19461",  # Teak
                "accent_colour": "#8EABC1",  # Nepal
                "default_target_pct": Decimal("30"),
                "sla_hours": 12,
            },
        )
        self.stdout.write(
            f"{'Created' if created else 'Found'} business {business.name} (#{business.id})"
        )

        for code, name, category in CANONICALS:
            CanonicalIngredient.objects.get_or_create(
                code=code, defaults={"name": name, "category": category}
            )

        vendors = {}
        for code, name, category, terms in VENDORS:
            vendor, _ = Vendor.objects.get_or_create(
                business=business,
                code=code,
                defaults={"name": name, "category": category, "terms": terms},
            )
            vendors[code] = vendor

        ingredients = {}
        for code, name, category, unit, rate, vendor_code, canonical, shared, target in INGREDIENTS:
            canonical_obj = (
                CanonicalIngredient.objects.filter(code=canonical).first() if canonical else None
            )
            ingredient, _ = Ingredient.objects.get_or_create(
                business=business,
                code=code,
                defaults={
                    "name": name,
                    "category": category,
                    "unit": unit,
                    "rate": Decimal(rate),
                    "vendor": vendors.get(vendor_code),
                    "shared": shared,
                    "track": True,
                    "canonical": canonical_obj,
                    "recipe_unit": "g",
                    # Stock is in kg, recipes are in grams. 1000 g per kg.
                    "recipe_units_per_stock_unit": (
                        Decimal("1000") if unit == StockUnit.KG else Decimal("1")
                    ),
                    "yield_pct": Decimal("100"),
                    "target_pct": Decimal(target) if target else None,
                },
            )
            ingredients[code] = ingredient

        if options["replace_dishes"] or options["dishes"]:
            self._replace_dishes(business)

        if options["dishes"]:
            count = self._load_dishes(business, ingredients, Path(options["dishes"]))
            self.stdout.write(self.style.SUCCESS(f"Loaded {count} real dishes."))
        else:
            self._seed_placeholders(business, ingredients)

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {len(vendors)} vendors, {len(ingredients)} ingredients, "
                f"{Dish.objects.filter(business=business).count()} dishes."
            )
        )
        if not options["dishes"]:
            self.stdout.write(
                self.style.WARNING(
                    "Dishes are PLACEHOLDERS at ₹0 — see docs/DECISIONS.md D-003. Cost% will read as "
                    "unusable until real prices are loaded with --dishes."
                )
            )

    def _replace_dishes(self, business):
        from inventory.models import Sale

        existing = Dish.objects.filter(business=business)
        with_sales = (
            Sale.objects.filter(business=business, dish__in=existing)
            .values_list("dish__name", flat=True)
            .distinct()
        )
        if with_sales:
            raise CommandError(
                "These dishes already have sales recorded and cannot be deleted: "
                + ", ".join(sorted(set(with_sales)))
                + ". Edit them in the app instead."
            )
        deleted, _ = existing.delete()
        self.stdout.write(f"Removed {deleted} existing dish row(s).")

    def _seed_placeholders(self, business, ingredients):
        for index, (name, section, ingredient_code) in enumerate(PLACEHOLDER_DISHES, start=1):
            ingredient = ingredients.get(ingredient_code)
            if ingredient is None:
                continue
            Dish.objects.get_or_create(
                business=business,
                code=f"PH{index:02d}",
                defaults={
                    "name": f"PLACEHOLDER — {name}",
                    "section": section,
                    "price": Decimal("0"),
                    "ing": ingredient,
                    "notes": "Placeholder: real name and price pending (docs/DECISIONS.md D-003).",
                },
            )

    def _load_dishes(self, business, ingredients, path: Path) -> int:
        if not path.exists():
            raise CommandError(f"No such file: {path}")
        count = 0
        with path.open(newline="", encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                ingredient = ingredients.get((row.get("ingredient_code") or "").strip())
                if ingredient is None:
                    raise CommandError(
                        f"Row '{row.get('name')}' references unknown ingredient_code "
                        f"'{row.get('ingredient_code')}'."
                    )
                Dish.objects.update_or_create(
                    business=business,
                    code=row["code"].strip(),
                    defaults={
                        "name": row["name"].strip(),
                        "section": (row.get("section") or "").strip(),
                        "price": Decimal(row["price"]),
                        "ing": ingredient,
                    },
                )
                count += 1
        return count
