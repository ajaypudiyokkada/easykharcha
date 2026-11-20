from django.db import migrations
from django.db.models import F


def backfill(apps, schema_editor):
    """Lines of invoices created inside EasyKharcha were recorded at their full amount, so their
    recorded amount is their amount (kind already defaults to "item")."""
    InvoiceLine = apps.get_model("invoices", "InvoiceLine")
    InvoiceLine.objects.filter(recorded_amount__isnull=True).update(recorded_amount=F("amount"))


class Migration(migrations.Migration):
    dependencies = [("invoices", "0005_invoice_bill_date_invoice_bill_date_printed_and_more")]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
