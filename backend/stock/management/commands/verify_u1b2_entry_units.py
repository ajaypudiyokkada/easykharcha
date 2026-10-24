"""Step U1b-2's acceptance check: the entry-unit/pack-size conversion rules from
docs/UNIT_REDESIGN.md, run against throwaway StockItem rows (created and rolled back inside one
transaction — never touches real data), exercising the same stock/units.py functions every
purchase/count/wastage/recipe-ingredient view calls.

Run: python manage.py verify_u1b2_entry_units
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from businesses.models import Business
from stock.models import StockItem
from stock.serializers import StockItemRowSerializer
from stock.units import (
    UnitEntryError,
    UnitFamily,
    convert_entry_price,
    convert_entry_quantity,
    display_price_per_major_unit,
    display_quantity,
)

User = get_user_model()


class Command(BaseCommand):
    help = "Proves the U1b-2 entry-unit/pack-size/price/display conversion rules."

    def handle(self, *args, **options):
        failures: list[str] = []

        with transaction.atomic():
            user, _ = User.objects.get_or_create(
                mobile="9999999999", defaults={"name": "U1b-2 check user"}
            )
            business = Business.objects.create(name="U1b-2 check business", created_by=user)

            self._check_milk(business, user, failures)
            self._check_basmati(business, user, failures)
            self._check_packets(business, user, failures)
            self._check_missing_pack_size(business, user, failures)
            self._check_wrong_family(business, user, failures)
            self._check_price(failures)
            self._check_display(failures)
            self._check_stock_item_create_serializer(failures)

            transaction.set_rollback(True)

        if failures:
            for f in failures:
                self.stderr.write(self.style.ERROR(f"FAIL: {f}"))
            raise CommandError(f"{len(failures)} check(s) failed")
        self.stdout.write(self.style.SUCCESS("All U1b-2 entry-unit regression checks passed."))

    def _item(self, business, user, **kwargs):
        defaults = {"unit": "g", "unit_family": UnitFamily.WEIGHT}
        defaults.update(kwargs)
        return StockItem.objects.create(
            business=business,
            created_by=user,
            name=f"check-{StockItem.objects.count()}",
            **defaults,
        )

    def _expect(self, failures, label, actual, expected):
        if actual != expected:
            failures.append(f"{label}: expected {expected!r}, got {actual!r}")

    def _check_milk(self, business, user, failures):
        milk = self._item(business, user, unit="ml", unit_family=UnitFamily.VOLUME)
        bought = convert_entry_quantity(Decimal("20"), "L", milk)
        counted = convert_entry_quantity(Decimal("8"), "L", milk)
        self._expect(failures, "Milk: 20 L bought", bought, Decimal("20000.000"))
        self._expect(failures, "Milk: 8 L counted", counted, Decimal("8000.000"))
        self.stdout.write(f"Milk: 20 L -> {bought} ml, 8 L -> {counted} ml")

    def _check_basmati(self, business, user, failures):
        rice = self._item(business, user, unit="g", unit_family=UnitFamily.WEIGHT)
        bought = convert_entry_quantity(Decimal("5"), "kg", rice)
        recipe_kg = convert_entry_quantity(Decimal("0.2"), "kg", rice)
        recipe_g = convert_entry_quantity(Decimal("200"), "g", rice)
        recipe_bare = convert_entry_quantity(Decimal("200"), None, rice)
        self._expect(failures, "Basmati: 5 kg bought", bought, Decimal("5000.000"))
        self._expect(failures, "Basmati: 0.2 kg recipe", recipe_kg, Decimal("200.000"))
        self._expect(failures, "Basmati: 200 g recipe", recipe_g, Decimal("200.000"))
        self._expect(failures, "Basmati: 200 (bare) recipe", recipe_bare, Decimal("200.000"))
        self.stdout.write(
            f"Basmati: 5 kg -> {bought} g; 0.2 kg / 200 g / 200 (bare) all -> {recipe_g} g"
        )

    def _check_packets(self, business, user, failures):
        flour = self._item(
            business,
            user,
            unit="g",
            unit_family=UnitFamily.WEIGHT,
            pack_size_base_qty=Decimal("500"),
        )
        packets = convert_entry_quantity(Decimal("2"), "packet", flour)
        self._expect(failures, "Packets: 2 x 500 g", packets, Decimal("1000.000"))
        self.stdout.write(f"Packets: 2 packets -> {packets} g")

    def _check_missing_pack_size(self, business, user, failures):
        oil = self._item(business, user, unit="ml", unit_family=UnitFamily.VOLUME)
        try:
            convert_entry_quantity(Decimal("2"), "bottle", oil)
            failures.append("Missing pack size: expected UnitEntryError, none raised")
        except UnitEntryError as exc:
            self.stdout.write(f"Missing pack size: correctly rejected -> {exc}")

    def _check_wrong_family(self, business, user, failures):
        rice = self._item(business, user, unit="g", unit_family=UnitFamily.WEIGHT)
        try:
            convert_entry_quantity(Decimal("5"), "L", rice)
            failures.append("Wrong family: expected UnitEntryError, none raised")
        except UnitEntryError as exc:
            self.stdout.write(f"Wrong family (L on a weight item): correctly rejected -> {exc}")

    def _check_price(self, failures):
        rice = StockItem(unit="g", unit_family=UnitFamily.WEIGHT)
        price_per_g = convert_entry_price(Decimal("280"), "kg", rice)
        self._expect(failures, "Price: Rs 280/kg -> per g", price_per_g, Decimal("0.2800"))
        back = display_price_per_major_unit(price_per_g, "g")
        self._expect(failures, "Price: per g -> owner-facing per kg", back, Decimal("280.00"))
        self.stdout.write(f"Price: Rs 280/kg -> Rs {price_per_g}/g -> displays as Rs {back}/kg")

    def _check_display(self, failures):
        big, big_unit = display_quantity(Decimal("3200"), "g")
        small, small_unit = display_quantity(Decimal("999"), "g")
        self._expect(failures, "Display: 3200 g value", big, Decimal("3.2"))
        self._expect(failures, "Display: 3200 g unit", big_unit, "kg")
        self._expect(failures, "Display: 999 g value", small, Decimal("999"))
        self._expect(failures, "Display: 999 g unit", small_unit, "g")
        self.stdout.write(f"Display: 3200 g -> {big} {big_unit}; 999 g -> {small} {small_unit}")

    def _check_stock_item_create_serializer(self, failures):
        serializer = StockItemRowSerializer(data={"name": "Ghee", "unit": "kg"})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        self._expect(failures, "Create: kg entry -> stored unit", data["unit"], "g")
        self._expect(failures, "Create: kg entry -> family", data["unit_family"], UnitFamily.WEIGHT)
        count_serializer = StockItemRowSerializer(data={"name": "Sheet pans", "unit": "sheet"})
        count_serializer.is_valid(raise_exception=True)
        count_data = count_serializer.validated_data
        self._expect(failures, "Create: sheet entry -> stored unit", count_data["unit"], "sheet")
        self._expect(
            failures, "Create: sheet entry -> family", count_data["unit_family"], UnitFamily.COUNT
        )
        self.stdout.write(
            "Stock item create: 'kg' entry -> unit=g/family=weight; "
            "'sheet' entry -> unit=sheet/family=count (byte-identical, non-convertible)"
        )
