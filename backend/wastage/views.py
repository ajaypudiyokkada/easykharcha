from datetime import datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db.models import F, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.log import log_action
from businesses.models import Business
from businesses.permissions import access_or_403, permissions_for, require_permission
from purchases.models import PurchaseLine

from .models import WastageEntry
from .serializers import WastageCreateSerializer, WastageEntrySerializer

ZERO = Decimal("0")


def _business_today(business: Business):
    tz = ZoneInfo(business.timezone)
    return timezone.localtime(timezone.now(), tz).date()


def _business_day_bounds(business: Business, date_):
    tz = ZoneInfo(business.timezone)
    start = datetime.combine(date_, time.min, tzinfo=tz)
    return start, start + timedelta(days=1)


def _value_sum(qs) -> Decimal:
    total = qs.filter(unit_cost_at_entry__isnull=False).aggregate(
        total=Sum(F("quantity") * F("unit_cost_at_entry"))
    )["total"]
    return total or ZERO


def _unit_cost_for(stock_item) -> Decimal | None:
    last_line = (
        PurchaseLine.objects.filter(stock_item=stock_item, purchase__is_deleted=False)
        .order_by("-purchase__purchase_date_time", "-id")
        .first()
    )
    if last_line is not None:
        return last_line.unit_price
    return stock_item.usual_price


def _summary_for(business: Business) -> dict:
    today = _business_today(business)
    today_start, today_end = _business_day_bounds(business, today)
    week_start = today_start - timedelta(days=7)
    active = WastageEntry.objects.filter(business=business, is_deleted=False)
    today_qs = active.filter(recorded_at__gte=today_start, recorded_at__lt=today_end)
    week_qs = active.filter(recorded_at__gte=week_start, recorded_at__lt=today_end)
    return {
        "today_value": str(_value_sum(today_qs)),
        "last_7_days_value": str(_value_sum(week_qs)),
        "today_entries": today_qs.count(),
    }


class WastageListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        access = access_or_403(business, request.user)
        permissions = permissions_for(access.role)
        can_value = "wastage.view_value" in permissions
        can_view_all = "wastage.view_all" in permissions
        can_view_own = "wastage.view_own" in permissions
        if not (can_view_all or can_view_own):
            raise PermissionDenied()

        qs = WastageEntry.objects.filter(business=business, is_deleted=False).select_related(
            "stock_item", "recorded_by"
        )

        summary = None
        if can_value:
            # Owner/Manager: the full history, not just today's — the Wastage screen's own
            # today/7-day summary strip is computed separately below.
            summary = _summary_for(business)
        else:
            # Head chef (all entries) / Helper (own entries only) — both scoped to today, per spec.
            start, end = _business_day_bounds(business, _business_today(business))
            qs = qs.filter(recorded_at__gte=start, recorded_at__lt=end)
            if can_view_own and not can_view_all:
                qs = qs.filter(recorded_by=request.user)

        qs = qs.order_by("-recorded_at", "-id")
        data = WastageEntrySerializer(qs, many=True).data
        if not can_value:
            for item in data:
                item.pop("value", None)

        body = {"results": data}
        if summary is not None:
            body["summary"] = summary
        return Response(body)

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        access = require_permission(business, request.user, "wastage.create")

        serializer = WastageCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        stock_item = business.stock_items.filter(id=data["stock_item"], active=True).first()
        if stock_item is None:
            raise ValidationError({"stock_item": "Choose a stock item from this business."})

        entry = WastageEntry.objects.create(
            business=business,
            stock_item=stock_item,
            quantity=data["quantity"],
            reason=data["reason"],
            note=data["note"],
            recorded_by=request.user,
            unit_cost_at_entry=_unit_cost_for(stock_item),
        )
        log_action(
            user=request.user,
            action="wastage.create",
            business=business,
            entry_id=entry.id,
            stock_item=stock_item.name,
            quantity=str(entry.quantity),
            reason=entry.reason,
        )

        can_value = "wastage.view_value" in permissions_for(access.role)
        item_data = WastageEntrySerializer(entry).data
        if not can_value:
            item_data.pop("value", None)
        return Response(item_data, status=201)


class WastageDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, business_id, entry_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "wastage.delete")
        entry = get_object_or_404(WastageEntry, id=entry_id, business=business, is_deleted=False)

        entry.is_deleted = True
        entry.deleted_by = request.user
        entry.deleted_at = timezone.now()
        entry.save(update_fields=["is_deleted", "deleted_by", "deleted_at"])

        log_action(
            user=request.user,
            action="wastage.delete",
            business=business,
            entry_id=entry.id,
            stock_item=entry.stock_item.name,
            quantity=str(entry.quantity),
        )
        return Response(status=204)
