from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.log import log_action
from businesses.models import Business
from businesses.permissions import require_permission

from .models import AlertCheck
from .serializers import AlertCheckSerializer
from .service import ALERT_TYPES, open_alerts


class AlertListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        access = require_permission(business, request.user, "alerts.view")

        alerts = open_alerts(business, access.role)

        counts = {alert_type: 0 for alert_type in ALERT_TYPES}
        for alert in alerts:
            counts[alert["type"]] += 1
        counts["total"] = len(alerts)

        requested_type = request.query_params.get("type")
        if requested_type:
            alerts = [alert for alert in alerts if alert["type"] == requested_type]

        return Response({"results": alerts, "counts": counts})


class AlertCheckView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        access = require_permission(business, request.user, "alerts.check")

        serializer = AlertCheckSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        key = serializer.validated_data["key"]

        open_keys = {alert["key"] for alert in open_alerts(business, access.role)}
        if key not in open_keys:
            raise ValidationError({"key": "This alert is no longer open."})

        AlertCheck.objects.get_or_create(
            business=business, alert_key=key, defaults={"checked_by": request.user}
        )

        log_action(
            user=request.user,
            action="alert.check",
            business=business,
            alert_key=key,
            alert_type=key.split(":", 1)[0],
        )
        return Response(status=204)
