"""Step 41b1b3a: every existing StockItem's `low_stock_category` defaulted to `dry_staples` (the
field's model default) when 0009 added the column — this backfills the perishable half of that
split from `goes_off`, same binary source the base-unit migrations already draw from. Reversible:
reverse sets every row back to `dry_staples` (the pre-backfill state), losing nothing since nothing
but this migration had ever set the column."""

from django.db import migrations

PERISHABLE = "perishable"
DRY_STAPLES = "dry_staples"


def backfill_from_goes_off(apps, schema_editor):
    StockItem = apps.get_model("stock", "StockItem")
    StockItem.objects.filter(goes_off=True).update(low_stock_category=PERISHABLE)


def reverse_to_dry_staples(apps, schema_editor):
    StockItem = apps.get_model("stock", "StockItem")
    StockItem.objects.filter(low_stock_category=PERISHABLE).update(low_stock_category=DRY_STAPLES)


class Migration(migrations.Migration):

    dependencies = [
        ("stock", "0009_stockitem_low_stock_category_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill_from_goes_off, reverse_to_dry_staples),
    ]
