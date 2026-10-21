from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("businesses", "0007_business_country_business_pincode_business_state"),
    ]

    operations = [
        migrations.AddField(
            model_name="businesssettings",
            name="day_starts_hour",
            field=models.PositiveSmallIntegerField(default=5),
            preserve_default=False,
        ),
    ]
