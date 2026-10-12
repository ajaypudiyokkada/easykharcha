from decimal import Decimal

from django.conf import settings as django_settings
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.log import log_action

from .access import owner_access_or_403
from .models import Business, BusinessSettings

FIELDS = ("count_deadline_hour", "target_cost_pct", "wastage_alert_pct", "rate_creep_pct")


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

    class Meta:
        model = BusinessSettings
        fields = FIELDS


class BusinessSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        owner_access_or_403(business, request.user)
        return Response(BusinessSettingsSerializer(business.settings).data)

    def patch(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        owner_access_or_403(business, request.user)

        serializer = BusinessSettingsSerializer(business.settings, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        log_action(
            user=request.user,
            action="business_settings.update",
            business=business,
            fields=sorted(serializer.validated_data.keys()),
        )
        return Response(serializer.data)
