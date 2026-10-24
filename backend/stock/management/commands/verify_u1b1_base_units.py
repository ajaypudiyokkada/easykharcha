"""Step U1b-1's acceptance check (docs/UNIT_REDESIGN.md's "Regression cases", run in base units):
the Milk gap-maths example and a kg-bought/gram-used recipe line, both run through the *real*
`counts.gap.lines_with_gap` — not a reimplementation — against this dev DB's own migrated seed data
(business 15, stock item 20 "Milk", count line 8). Only adds the one Sale row the seed data is
missing (100 Tea packs on 2026-10-22, matching SellItemIngredient #7's 200 ml/portion) to make the
window comparable, then rolls the whole thing back — never touches real data.

Run: python manage.py verify_u1b1_base_units
"""

from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from businesses.models import Business
from counts.gap import lines_with_gap
from counts.models import CountLine
from sales.models import Sale
from stock.models import SellItem, StockItem


class Command(BaseCommand):
    help = "Proves the Milk and kg-bought/gram-used base-unit regression cases against real data."

    def handle(self, *args, **options):
        failures = []

        with transaction.atomic():
            self._check_milk(failures)
            self._check_kg_to_grams(failures)
            transaction.set_rollback(True)

        if failures:
            for f in failures:
                self.stderr.write(self.style.ERROR(f"FAIL: {f}"))
            raise CommandError(f"{len(failures)} check(s) failed")
        self.stdout.write(self.style.SUCCESS("All U1b-1 base-unit regression checks passed."))

    def _check_milk(self, failures: list):
        try:
            count_line = CountLine.objects.select_related("count", "stock_item").get(id=8)
        except CountLine.DoesNotExist:
            failures.append("Milk: seed CountLine #8 not found — dev DB seed data has changed.")
            return

        item = count_line.stock_item
        if item.name != "Milk" or item.unit != "ml":
            failures.append(f"Milk: expected stock item 'Milk'/ml, got {item.name}/{item.unit}.")
            return

        business = Business.objects.get(id=count_line.count.business_id)
        sell_item = SellItem.objects.get(ingredients__stock_item=item)
        Sale.objects.create(
            business=business,
            sell_item=sell_item,
            business_date=date(2026, 10, 22),
            quantity=Decimal("100"),
            amount=Decimal("0"),
            recorded_by=count_line.count.counted_by,
        )

        lines = lines_with_gap(business, count_line.count)
        line = next(row for row in lines if row["stock_item"] == item.id)

        expectations = {
            "used_since_last_count": Decimal("22500.000"),
            "expected_used": Decimal("20000"),
            "gap_qty": Decimal("2500"),
            "gap_value": Decimal("160.0000"),
            "flagged": True,
        }
        for field, expected in expectations.items():
            actual = line[field]
            if actual != expected:
                failures.append(f"Milk: {field} expected {expected}, got {actual}")

        gap_pct = (line["gap_qty"] / line["expected_used"]) * 100
        if gap_pct != Decimal("12.5"):
            failures.append(f"Milk: gap% expected 12.5, got {gap_pct}")

        self.stdout.write(
            f"Milk: used={line['used_since_last_count']} ml, expected={line['expected_used']} ml, "
            f"gap={line['gap_qty']} ml = Rs {line['gap_value']} = {gap_pct}%"
        )

    def _check_kg_to_grams(self, failures: list):
        item = StockItem.objects.filter(name="Basmati Rice", unit="g").first()
        if item is None:
            failures.append("kg-to-g: no migrated 'Basmati Rice' (g) stock item found.")
            return

        purchase_line = item.purchase_lines.first()
        ingredient_line = item.used_in.first()
        if purchase_line is None or ingredient_line is None:
            failures.append(
                "kg-to-g: Basmati Rice is missing a purchase or recipe line to compare."
            )
            return

        # Both paths must land on the same gram scale with no drift between them — a bulk kg
        # purchase (5 kg -> 5000 g) and a small-gram recipe line (0.2 kg -> 200 g).
        if purchase_line.quantity != Decimal("5000"):
            failures.append(
                f"kg-to-g: purchase quantity expected 5000 g, got {purchase_line.quantity}"
            )
        if ingredient_line.quantity != Decimal("200"):
            failures.append(
                f"kg-to-g: ingredient quantity expected 200 g, got {ingredient_line.quantity}"
            )
        if purchase_line.unit_price != Decimal("0.0600"):
            failures.append(f"kg-to-g: unit_price expected 0.0600, got {purchase_line.unit_price}")

        self.stdout.write(
            f"Basmati Rice (kg->g): purchase {purchase_line.quantity} g @ Rs {purchase_line.unit_price}/g, "
            f"recipe uses {ingredient_line.quantity} g/portion"
        )
