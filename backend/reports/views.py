from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from businesses.models import Business
from businesses.permissions import require_permission

from .service import PERIOD_DAYS, summary_for


class ReportsSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "reports.view")

        period = request.query_params.get("period") or "7d"
        if period not in PERIOD_DAYS:
            period = "7d"

        item_param = request.query_params.get("item")
        item_id = int(item_param) if item_param and item_param.isdigit() else None

        return Response(summary_for(business, period, item_id))
