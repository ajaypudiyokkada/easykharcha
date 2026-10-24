"""Step U1b-1's base-unit backfill (see docs/UNIT_REDESIGN.md). Rebases every StockItem whose
`unit` is `kg`/`L`/`tonne` onto its family's base unit (g/ml) — and every quantity/price row that
depends on it — then sets `unit_family` on every stock item, convertible or not.

Deliberately hardcodes its own copy of the factor/family mapping instead of importing
`stock.units` — a migration must keep behaving exactly the same even if that module's mapping
changes later; `stock.units` is for *current* code (serializers, the AI path), this file is a
frozen record of what *this* migration did.

Known limitation of the reverse migration: once forward has run, a weight-family item's `unit` is
always `g` — there is no remaining way to tell a kg-origin item from a tonne-origin one apart from
backup/audit-log data outside this migration. The current dev DB has zero `tonne` items (confirmed
in docs/UNIT_REDESIGN.md's audit: 533 kg, 199 L, 20 sheet, 12 pack, 2 piece), so reverse treats
every weight-family item as kg-origin — correct for all data that exists today. If a genuine
tonne-origin item is ever converted by this migration before it's reversed, reverse will rescale it
as if it were kg (x1,000 instead of x1,000,000) — restore from the pre-migration backup instead in
that specific case.
"""

from decimal import ROUND_HALF_UP, Decimal

from django.db import migrations, transaction

WEIGHT_FACTORS = {"kg": Decimal("1000"), "tonne": Decimal("1000000")}
VOLUME_FACTORS = {"L": Decimal("1000")}
PRICE_QUANTUM = Decimal("0.0001")

# Reverse only ever needs the one real-world factor (see module docstring) — ml always came from L.
REVERSE_WEIGHT_FACTOR = Decimal("1000")
REVERSE_VOLUME_FACTOR = Decimal("1000")


def _quantity_querysets(apps, item):
    PurchaseLine = apps.get_model("purchases", "PurchaseLine")
    CountLine = apps.get_model("counts", "CountLine")
    WastageEntry = apps.get_model("wastage", "WastageEntry")
    SellItemIngredient = apps.get_model("stock", "SellItemIngredient")
    return [
        (PurchaseLine.objects.filter(stock_item=item), "quantity"),
        (CountLine.objects.filter(stock_item=item, counted_qty__isnull=False), "counted_qty"),
        (WastageEntry.objects.filter(stock_item=item), "quantity"),
        (SellItemIngredient.objects.filter(stock_item=item), "quantity"),
    ]


def _price_querysets(apps, item):
    PurchaseLine = apps.get_model("purchases", "PurchaseLine")
    WastageEntry = apps.get_model("wastage", "WastageEntry")
    return [
        (PurchaseLine.objects.filter(stock_item=item), "unit_price"),
        (WastageEntry.objects.filter(stock_item=item, unit_cost_at_entry__isnull=False), "unit_cost_at_entry"),
    ]


def _rescale(qs, field, factor):
    count = 0
    for row in qs:
        setattr(row, field, getattr(row, field) * factor)
        row.save(update_fields=[field])
        count += 1
    return count


def _rescale_price(qs, field, factor):
    count = 0
    for row in qs:
        value = getattr(row, field)
        setattr(row, field, (value / factor).quantize(PRICE_QUANTUM, rounding=ROUND_HALF_UP))
        row.save(update_fields=[field])
        count += 1
    return count


def backfill_base_units(apps, schema_editor):
    StockItem = apps.get_model("stock", "StockItem")

    converted = {"weight": 0, "volume": 0, "count": 0}
    row_counts: dict[str, int] = {}

    for item in StockItem.objects.all().iterator():
        old_unit = item.unit
        if old_unit in WEIGHT_FACTORS:
            factor, new_unit, family = WEIGHT_FACTORS[old_unit], "g", "weight"
        elif old_unit in VOLUME_FACTORS:
            factor, new_unit, family = VOLUME_FACTORS[old_unit], "ml", "volume"
        elif old_unit == "g":
            factor, new_unit, family = None, old_unit, "weight"
        elif old_unit == "ml":
            factor, new_unit, family = None, old_unit, "volume"
        else:
            factor, new_unit, family = None, old_unit, "count"

        with transaction.atomic():
            if factor is not None:
                for qs, field in _quantity_querysets(apps, item):
                    row_counts[field] = row_counts.get(field, 0) + _rescale(qs, field, factor)
                for qs, field in _price_querysets(apps, item):
                    row_counts[field] = row_counts.get(field, 0) + _rescale_price(qs, field, factor)
                if item.usual_price is not None:
                    item.usual_price = (item.usual_price / factor).quantize(
                        PRICE_QUANTUM, rounding=ROUND_HALF_UP
                    )
                item.unit = new_unit
            item.unit_family = family
            item.save(update_fields=["unit", "unit_family", "usual_price"])
        converted[family] += 1

    print(
        f"\nbackfill_base_units: stock items by family {converted}; "
        f"rescaled rows {row_counts}"
    )


def reverse_base_units(apps, schema_editor):
    StockItem = apps.get_model("stock", "StockItem")

    restored = {"weight": 0, "volume": 0, "count": 0}
    row_counts: dict[str, int] = {}

    for item in StockItem.objects.all().iterator():
        family = item.unit_family
        if family == "weight" and item.unit == "g":
            factor, old_unit = REVERSE_WEIGHT_FACTOR, "kg"
        elif family == "volume" and item.unit == "ml":
            factor, old_unit = REVERSE_VOLUME_FACTOR, "L"
        else:
            factor, old_unit = None, item.unit

        with transaction.atomic():
            if factor is not None:
                for qs, field in _quantity_querysets(apps, item):
                    row_counts[field] = row_counts.get(field, 0) + _rescale(qs, field, Decimal(1) / factor)
                for qs, field in _price_querysets(apps, item):
                    row_counts[field] = row_counts.get(field, 0) + _rescale_price(qs, field, Decimal(1) / factor)
                if item.usual_price is not None:
                    item.usual_price = (item.usual_price * factor).quantize(
                        PRICE_QUANTUM, rounding=ROUND_HALF_UP
                    )
                item.unit = old_unit
            item.unit_family = "count"
            item.save(update_fields=["unit", "unit_family", "usual_price"])
        restored[family] += 1

    print(
        f"\nreverse_base_units: stock items by original family {restored}; "
        f"rescaled rows {row_counts}"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("stock", "0006_base_units"),
        ("purchases", "0002_base_units"),
        ("wastage", "0002_base_units"),
        ("counts", "0002_stockcount_missing_opening"),
    ]

    operations = [
        migrations.RunPython(backfill_base_units, reverse_base_units),
    ]
