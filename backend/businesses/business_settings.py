from decimal import Decimal

from django.conf import settings as django_settings
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.log import jsonable, log_action

from .models import Business, BusinessSettings
from .permissions import require_permission

FIELDS = (
    "count_deadline_hour",
    "closing_count_hour",
    "target_cost_pct",
    "wastage_alert_pct",
    "rate_creep_pct",
    "gap_alert_pct",
)


def defaults_for_new_business() -> dict:
    """Used when a Business (and its one-row BusinessSettings) is created."""
    return dict(django_settings.BUSINESS_SETTINGS_DEFAULTS)


def _range(field: str) -> tuple[int, int]:
    return django_settings.BUSINESS_SETTINGS_RANGES[field]


class BusinessSettingsSerializer(serializers.ModelSerializer):
    # Declared explicitly (not left to ModelSerializer's auto-generated fields) so the valid range
    # for each one comes from settings.BUSINESS_SETTINGS_RANGES, the same source of truth the report
    # and defaults_for_new_business() use, rather than being hardcoded a second time here.
    count_deadline_hour = serializers.IntegerField(
        min_value=_range("count_deadline_hour")[0], max_value=_range("count_deadline_hour")[1]
    )
    closing_count_hour = serializers.IntegerField(
        min_value=_range("closing_count_hour")[0], max_value=_range("closing_count_hour")[1]
    )
    target_cost_pct = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        min_value=Decimal(_range("target_cost_pct")[0]),
        max_value=Decimal(_range("target_cost_pct")[1]),
    )
    wastage_alert_pct = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        min_value=Decimal(_range("wastage_alert_pct")[0]),
        max_value=Decimal(_range("wastage_alert_pct")[1]),
    )
    rate_creep_pct = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        min_value=Decimal(_range("rate_creep_pct")[0]),
        max_value=Decimal(_range("rate_creep_pct")[1]),
    )
    gap_alert_pct = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        min_value=Decimal(_range("gap_alert_pct")[0]),
        max_value=Decimal(_range("gap_alert_pct")[1]),
    )

    class Meta:
        model = BusinessSettings
        fields = FIELDS


class BusinessSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "settings.manage")
        return Response(BusinessSettingsSerializer(business.settings).data)

    def patch(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "settings.manage")

        settings_row = business.settings
        serializer = BusinessSettingsSerializer(settings_row, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        changed = list(serializer.validated_data.keys())
        before = {f: jsonable(getattr(settings_row, f)) for f in changed}
        serializer.save()
        after = {f: jsonable(getattr(settings_row, f)) for f in changed}
        log_action(
            user=request.user,
            action="business_settings.update",
            business=business,
            before=before,
            after=after,
        )
        return Response(serializer.data)
