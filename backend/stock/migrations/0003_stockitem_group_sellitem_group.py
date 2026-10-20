from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("stock", "0002_sellitem_uses_qty"),
    ]

    operations = [
        migrations.AddField(
            model_name="stockitem",
            name="group",
            field=models.CharField(blank=True, default="", max_length=40),
        ),
        migrations.AddField(
            model_name="sellitem",
            name="group",
            field=models.CharField(blank=True, default="", max_length=40),
        ),
    ]
