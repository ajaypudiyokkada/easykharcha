"""Create a clearly-labelled DEMO tenant with the §5b worked example already recorded.

Kept separate from `seed_fomo` on purpose: FOMO is a real pilot tenant whose dishes are placeholders
awaiting real prices (docs/DECISIONS.md D-003). Putting invented prices into FOMO would blur that line.
Everything here is named "DEMO" so nobody can mistake it for a client's data.

The numbers reproduce the spec's worked example exactly:
  boneless chicken, opening 0.5 kg, purchased 5 kg, closing 0.8 kg, wastage 0.3 kg
  sold 20 chilli chicken (150 g) + 10 noodles (30 g) + 6 soup (30 g)
  => expected 3.48 kg, actual_used 4.7 kg, unexplained 0.92 kg (~26.4%) => alert
"""

from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from accounts.models import Access, User
from inventory.models import (
    Confidence,
    DailyStock,
    Dish,
    Ingredient,
    Purchase,
    RecipeLine,
    Sale,
    SaleSource,
    Vendor,
    Wastage,
    WastageReason,
)
from recipes.models import CanonicalIngredient
from tenants.models import Business, BusinessType

DEMO_NAME = "DEMO Kitchen"
DEMO_PIN = "1234"

DEMO_USERS = [
    ("9000000001", "Demo Owner", "owner"),
    ("9000000002", "Demo Manager", "manager"),
    ("9000000003", "Demo Head Chef", "head_chef"),
    ("9000000004", "Demo Staff", "staff"),
]


class Command(BaseCommand):
    help = "Create the DEMO tenant with the spec's worked example recorded."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset", action="store_true", help="Delete and recreate the DEMO tenant."
        )

    def _reset(self):
        """Delete the DEMO tenant child-first.

        Purchase/Sale/Wastage hold PROTECT references to Ingredient and Dish, so a plain
        `Business.delete()` raises instead of cascading. Deleting in dependency order is the honest
        fix; loosening those FKs to CASCADE would let a real tenant lose cost history to one click.
        """
        business = Business.objects.filter(name=DEMO_NAME).first()
        if business is None:
            self.stdout.write("Nothing to reset.")
            return

        RecipeLine.objects.filter(dish__business=business).delete()
        for model in (Sale, Wastage, Purchase, DailyStock):
            model.objects.filter(business=business).delete()
        Dish.objects.filter(business=business).delete()
        Ingredient.objects.filter(business=business).delete()
        Vendor.objects.filter(business=business).delete()
        Access.objects.filter(business=business).delete()
        business.delete()
        self.stdout.write(f"Reset: removed {DEMO_NAME}.")

    @transaction.atomic
    def handle(self, *args, **options):
        if options["reset"]:
            self._reset()

        business, created = Business.objects.get_or_create(
            name=DEMO_NAME,
            defaults={
                "tagline": "Sample data — not a real restaurant",
                "business_type": BusinessType.RESTAURANT,
                "primary_colour": "#2F6F4E",
                "accent_colour": "#D9A441",
                "default_target_pct": Decimal("30"),
                "variance_alert_pct": Decimal("10"),
                "sla_hours": 12,
            },
        )
        if not created:
            self.stdout.write(
                self.style.WARNING(
                    f"{DEMO_NAME} already exists — leaving it as is. Use --reset to rebuild."
                )
            )
            return

        users = {}
        for phone, name, role in DEMO_USERS:
            user, user_created = User.objects.get_or_create(phone=phone, defaults={"name": name})
            if user_created:
                user.set_pin(DEMO_PIN)
                user.save()
            Access.objects.update_or_create(
                business=business, user=user, defaults={"role": role, "active": True}
            )
            users[role] = user

        vendor = Vendor.objects.create(
            business=business, code="V-DEMO", name="DEMO Meat Supply", category="Meat"
        )

        canonical, _ = CanonicalIngredient.objects.get_or_create(
            code="CHICKEN_BONELESS", defaults={"name": "Chicken — boneless", "category": "Meat"}
        )

        chicken = Ingredient.objects.create(
            business=business,
            code="CHK-BNL",
            name="Chicken boneless",
            category="Meat",
            unit="kg",
            rate=Decimal("360"),
            vendor=vendor,
            canonical=canonical,
            recipe_unit="g",
            recipe_units_per_stock_unit=Decimal("1000"),
            yield_pct=Decimal("100"),
        )
        oil = Ingredient.objects.create(
            business=business,
            code="OIL-CK",
            name="Cooking oil",
            category="Groceries",
            unit="kg",
            rate=Decimal("160"),
            vendor=vendor,
            shared=True,
            recipe_unit="ml",
            recipe_units_per_stock_unit=Decimal("1000"),
        )

        # DEMO prices. Invented for illustration — that is fine here and only here.
        dishes = {}
        for code, name, section, price, grams in [
            ("D01", "DEMO Chilli chicken", "Starters", "260", 150),
            ("D02", "DEMO Chicken noodles", "Noodles", "210", 30),
            ("D03", "DEMO Chicken soup", "Soups", "140", 30),
        ]:
            dish = Dish.objects.create(
                business=business,
                code=code,
                name=name,
                section=section,
                price=Decimal(price),
                ing=chicken,
            )
            RecipeLine.objects.create(
                dish=dish,
                ingredient=chicken,
                qty_per_portion=Decimal(grams),
                confidence=Confidence.OWNER_STATED,
            )
            dishes[code] = dish

        today = timezone.localdate()
        yesterday = today - timedelta(days=1)
        now = timezone.now()

        chef, manager = users["head_chef"], users["manager"]

        # A closing count on the day before this week started, so the week-to-date report has an
        # opening figure to carry forward. Without it every cost reads as "count missing" and the
        # Owner dashboard has nothing to show.
        week_start = today - timedelta(days=today.weekday())
        day_before_week = week_start - timedelta(days=1)
        if day_before_week < yesterday:
            DailyStock.objects.create(
                business=business,
                ingredient=chicken,
                date=day_before_week,
                opening_qty=Decimal("0.5"),
                opened_by=chef,
                opened_at=now,
                closing_qty=Decimal("0.5"),
                closed_by=chef,
                closed_at=now,
            )
            DailyStock.objects.create(
                business=business,
                ingredient=oil,
                date=day_before_week,
                opening_qty=Decimal("4"),
                opened_by=chef,
                opened_at=now,
                closing_qty=Decimal("4"),
                closed_by=chef,
                closed_at=now,
            )

        # Opening 0.5 kg, closing 0.8 kg on the same day.
        DailyStock.objects.create(
            business=business,
            ingredient=chicken,
            date=yesterday,
            opening_qty=Decimal("0.5"),
            opened_by=chef,
            opened_at=now,
            closing_qty=Decimal("0.8"),
            closed_by=chef,
            closed_at=now,
        )
        DailyStock.objects.create(
            business=business,
            ingredient=oil,
            date=yesterday,
            opening_qty=Decimal("4"),
            opened_by=chef,
            opened_at=now,
            closing_qty=Decimal("3.2"),
            closed_by=chef,
            closed_at=now,
        )
        # Today's opening carries yesterday's closing forward, so the SLA screen looks lived-in.
        DailyStock.objects.create(
            business=business,
            ingredient=chicken,
            date=today,
            opening_qty=Decimal("0.8"),
            opened_by=chef,
            opened_at=now,
        )

        Purchase.objects.create(
            business=business,
            date=yesterday,
            vendor=vendor,
            ingredient=chicken,
            qty_invoiced=Decimal("5"),
            rate=Decimal("360"),
            qty_received=Decimal("5"),
            received_by=manager,
            received_at=now,
            invoice_ref="DEMO-001",
        )
        Purchase.objects.create(
            business=business,
            date=yesterday,
            vendor=vendor,
            ingredient=oil,
            qty_invoiced=Decimal("2"),
            rate=Decimal("160"),
            qty_received=Decimal("2"),
            received_by=manager,
            received_at=now,
            invoice_ref="DEMO-002",
        )

        Wastage.objects.create(
            business=business,
            date=yesterday,
            ingredient=chicken,
            qty=Decimal("0.3"),
            reason=WastageReason.SPOILAGE,
            entered_by=chef,
            entered_at=now,
        )

        for code, plates in [("D01", 20), ("D02", 10), ("D03", 6)]:
            dish = dishes[code]
            Sale.objects.create(
                business=business,
                date=yesterday,
                dish=dish,
                plates=plates,
                revenue=dish.price * plates,
                entered_by=manager,
                entered_at=now,
                source=SaleSource.MANUAL,
            )

        self.stdout.write(self.style.SUCCESS(f"Created {DEMO_NAME} (#{business.id})."))
        self.stdout.write("Logins (PIN 1234):")
        for phone, name, role in DEMO_USERS:
            self.stdout.write(f"  {phone}  {name:<18} {role}")
        self.stdout.write(
            "\nVariance for Chicken boneless over "
            f"{yesterday} should read: expected 3.480, actual 4.700, "
            "wastage 0.300, unexplained 0.920 kg (~26.44%) — alert."
        )
