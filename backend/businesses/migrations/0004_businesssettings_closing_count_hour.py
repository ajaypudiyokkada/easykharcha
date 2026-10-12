from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("businesses", "0003_business_checklist_dismissed_at_alter_access_role_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="businesssettings",
            name="closing_count_hour",
            field=models.PositiveSmallIntegerField(default=20),
            preserve_default=False,
        ),
    ]
