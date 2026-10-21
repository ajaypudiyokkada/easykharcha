from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("counts", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="stockcount",
            name="missing_opening",
            field=models.BooleanField(default=False),
        ),
    ]
