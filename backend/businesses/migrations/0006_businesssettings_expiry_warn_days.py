from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("businesses", "0005_businesssettings_gap_alert_pct"),
    ]

    operations = [
        migrations.AddField(
            model_name="businesssettings",
            name="expiry_warn_days",
            field=models.PositiveSmallIntegerField(default=2),
            preserve_default=False,
        ),
    ]
