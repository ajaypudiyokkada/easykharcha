from rest_framework import serializers

from tenants.models import Business


class BusinessSerializer(serializers.ModelSerializer):
    business_type_label = serializers.CharField(source="get_business_type_display", read_only=True)
    dish_label = serializers.CharField(read_only=True)
    count_day_label = serializers.CharField(source="get_count_day_display", read_only=True)

    class Meta:
        model = Business
        fields = (
            "id",
            "name",
            "tagline",
            "business_type",
            "business_type_label",
            "dish_label",
            "logo",
            "primary_colour",
            "accent_colour",
            "status",
            "default_target_pct",
            "waste_alert_pct",
            "rate_creep_pct",
            "variance_alert_pct",
            "sla_hours",
            "count_day",
            "count_day_label",
        )
        read_only_fields = ("id",)


class BusinessCreateSerializer(serializers.ModelSerializer):
    #: Copies FOMO's vendors/ingredients/dishes as a starting point rather than a blank screen (§7).
    seed_from_fomo = serializers.BooleanField(default=False, write_only=True)

    class Meta:
        model = Business
        fields = (
            "id",
            "name",
            "tagline",
            "business_type",
            "primary_colour",
            "accent_colour",
            "default_target_pct",
            "waste_alert_pct",
            "rate_creep_pct",
            "variance_alert_pct",
            "sla_hours",
            "count_day",
            "seed_from_fomo",
        )
