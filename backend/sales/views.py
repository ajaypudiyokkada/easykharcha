from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.log import log_action
from businesses.models import Business
from businesses.permissions import require_permission

from .exceptions import TooManySaleLines
from .models import Sale
from .serializers import SaleCreateSerializer, SaleSerializer
from .service import (
    MAX_LINES,
    business_today,
    check_sale_date,
    record_sales,
    validate_lines,
)

PAGE_SIZE = 50
ZERO = Decimal("0")


def _lines_from_request(request) -> list:
    lines = request.data.get("lines")
    if not isinstance(lines, list) or not lines:
        raise ValidationError({"lines": "Add at least one line."})
    if len(lines) > MAX_LINES:
        raise TooManySaleLines()
    return lines


def _summary_for(business: Business) -> dict:
    today = business_today(business)
    week_start = today - timedelta(days=6)
    active = Sale.objects.filter(business=business, is_deleted=False)
    today_qs = active.filter(business_date=today)
    week_qs = active.filter(business_date__gte=week_start, business_date__lte=today)

    sales_today = today_qs.aggregate(total=Sum("amount"))["total"] or ZERO
    items_sold_today = today_qs.aggregate(total=Sum("quantity"))["total"] or ZERO
    last_7_days = week_qs.aggregate(total=Sum("amount"))["total"] or ZERO
    last_sale = active.order_by("-created_at", "-id").first()
    return {
        "sales_today": str(sales_today),
        "items_sold_today": str(items_sold_today),
        "last_update_at": last_sale.created_at.isoformat() if last_sale else None,
        "last_7_days": str(last_7_days),
    }


class SaleListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.view")

        qs = Sale.objects.filter(business=business, is_deleted=False).select_related(
            "sell_item", "recorded_by"
        )

        date_from = request.query_params.get("date_from")
        date_to = request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(business_date__gte=date_from)
        if date_to:
            qs = qs.filter(business_date__lte=date_to)

        paginator = PageNumberPagination()
        paginator.page_size = PAGE_SIZE
        page = paginator.paginate_queryset(qs, request)
        response = paginator.get_paginated_response(SaleSerializer(page, many=True).data)
        response.data["summary"] = _summary_for(business)
        return response

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.create")

        header = SaleCreateSerializer(data=request.data)
        header.is_valid(raise_exception=True)
        business_date = header.validated_data["business_date"]
        check_sale_date(business, business_date)

        raw_lines = _lines_from_request(request)
        cleaned_lines = validate_lines(business, raw_lines)

        with transaction.atomic():
            created = record_sales(
                business=business,
                user=request.user,
                business_date=business_date,
                lines=cleaned_lines,
            )

        log_action(
            user=request.user,
            action="sale.create",
            business=business,
            business_date=str(business_date),
            line_count=len(created),
            total_amount=str(sum((sale.amount for sale in created), start=ZERO)),
            sale_ids=[sale.id for sale in created],
        )
        return Response(SaleSerializer(created, many=True).data, status=201)


class SaleDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, business_id, sid):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.delete")
        sale = get_object_or_404(Sale, id=sid, business=business, is_deleted=False)

        sale.is_deleted = True
        sale.deleted_by = request.user
        sale.deleted_at = timezone.now()
        sale.save(update_fields=["is_deleted", "deleted_by", "deleted_at"])

        log_action(
            user=request.user,
            action="sale.delete",
            business=business,
            sale_id=sale.id,
            sell_item=sale.sell_item.name,
            quantity=str(sale.quantity),
            amount=str(sale.amount),
        )
        return Response(status=204)
