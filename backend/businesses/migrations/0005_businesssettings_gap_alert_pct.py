from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("businesses", "0004_businesssettings_closing_count_hour"),
    ]

    operations = [
        migrations.AddField(
            model_name="businesssettings",
            name="gap_alert_pct",
            field=models.DecimalField(decimal_places=2, default=10, max_digits=5),
            preserve_default=False,
        ),
    ]
