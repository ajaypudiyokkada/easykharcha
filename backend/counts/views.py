from datetime import datetime, time, timedelta
from decimal import Decimal
from urllib.parse import quote
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Sum
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from alerts.service import open_alerts
from audit.log import log_action
from businesses.access import owner_access_or_403
from businesses.models import Access, Business
from businesses.permissions import access_or_403, permissions_for, require_permission
from purchases.models import PurchaseLine
from stock.units import UnitEntryError, convert_entry_quantity
from wastage.models import WastageEntry

from .business_day import business_date_for, has_any_count
from .config import (
    UNUSUAL_VALUE_LOOKBACK_COUNTS,
    UNUSUAL_VALUE_LOOKBACK_DAYS,
    UNUSUAL_VALUE_MULTIPLIER,
)
from .exceptions import CountValidationError, DuplicateCount, NeedsConfirmation, OpeningRequired
from .gap import ZERO, lines_with_gap
from .models import CountLine, CountLineState, CountType, StockCount
from .serializers import CountCreateSerializer, CountLineRowSerializer, StockCountSerializer
from .today_status import deadline_at_for, opening_missed, status_for


def _row_errors_from(row_number: int, errors: dict) -> list[dict]:
    flattened = []
    for field, messages in errors.items():
        message = messages[0] if isinstance(messages, list) else messages
        flattened.append({"row": row_number, "field": field, "message": str(message)})
    return flattened


def _is_unusual(business: Business, stock_item, counted_qty: Decimal | None, now) -> bool:
    """The guard rule from counts/config.py: flag a value more than 3x the higher of the item's own
    recent-count history or how much was bought recently — but only once there's at least one
    earlier count to compare against, and never for zero."""
    if counted_qty is None or counted_qty == 0:
        return False
    recent_counted = list(
        CountLine.objects.filter(
            stock_item=stock_item,
            count__business=business,
            state=CountLineState.COUNTED,
            counted_qty__isnull=False,
        )
        .order_by("-count__submitted_at")[:UNUSUAL_VALUE_LOOKBACK_COUNTS]
        .values_list("counted_qty", flat=True)
    )
    if not recent_counted:
        return False
    highest_recent = max(recent_counted)
    since = now - timedelta(days=UNUSUAL_VALUE_LOOKBACK_DAYS)
    bought_recently = (
        PurchaseLine.objects.filter(
            stock_item=stock_item,
            purchase__business=business,
            purchase__is_deleted=False,
            purchase__purchase_date_time__gte=since,
        ).aggregate(total=Sum("quantity"))["total"]
        or ZERO
    )
    threshold = max(highest_recent, bought_recently)
    return counted_qty > UNUSUAL_VALUE_MULTIPLIER * threshold


class CountFormView(APIView):
    """The blind form: active stock items with id, name and unit only. Nothing else — no last
    count, no expected, no prices, no usual values — enforced here by simply never selecting those
    fields, not by hiding them client-side."""

    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "counts.create")

        count_type = request.query_params.get("type")
        if count_type not in CountType.values:
            raise ValidationError({"type": "Choose opening or closing."})

        items = (
            business.stock_items.filter(active=True).order_by("name").values("id", "name", "unit")
        )
        return Response({"items": list(items)})


class CountListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "counts.review")

        business_date = request.query_params.get("date") or business_date_for(business).isoformat()
        counts = (
            StockCount.objects.filter(business=business, business_date=business_date)
            .select_related("counted_by")
            .prefetch_related("lines")
        )

        results = []
        for count in counts:
            lines = list(count.lines.all())
            results.append(
                {
                    **StockCountSerializer(count).data,
                    "items_counted": sum(
                        1 for line in lines if line.state == CountLineState.COUNTED
                    ),
                    "items_skipped": sum(
                        1 for line in lines if line.state == CountLineState.SKIPPED
                    ),
                    "items_not_sure": sum(
                        1 for line in lines if line.state == CountLineState.NOT_SURE
                    ),
                    "flagged_gaps": sum(
                        1 for line in lines_with_gap(business, count) if line["flagged"]
                    ),
                }
            )
        return Response(results)

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "counts.create")

        header = CountCreateSerializer(data=request.data)
        header.is_valid(raise_exception=True)
        count_type = header.validated_data["type"]
        confirm_ids = set(header.validated_data["confirm_ids"])

        now = timezone.now()
        business_date = business_date_for(business, now)
        is_first_count = not has_any_count(business)
        if StockCount.objects.filter(
            business=business, count_type=count_type, business_date=business_date
        ).exists():
            raise DuplicateCount()

        missing_opening = False
        if count_type == CountType.CLOSING:
            opening_done = StockCount.objects.filter(
                business=business, count_type=CountType.OPENING, business_date=business_date
            ).exists()
            if not opening_done:
                if not opening_missed(business, business_date, now):
                    raise OpeningRequired()
                missing_opening = True

        raw_lines = request.data.get("lines")
        if not isinstance(raw_lines, list) or not raw_lines:
            raise ValidationError({"lines": "Count or skip every item before saving."})

        active_items = {item.id: item for item in business.stock_items.filter(active=True)}

        row_errors: list[dict] = []
        cleaned = []
        seen_ids: set[int] = set()
        for index, row in enumerate(raw_lines, start=1):
            serializer = CountLineRowSerializer(data=row)
            if not serializer.is_valid():
                row_errors.extend(_row_errors_from(index, serializer.errors))
                continue
            data = serializer.validated_data
            item = active_items.get(data["stock_item"])
            if item is None:
                row_errors.append(
                    {
                        "row": index,
                        "field": "stock_item",
                        "message": "Choose a stock item from this business.",
                    }
                )
                continue
            if item.id in seen_ids:
                row_errors.append(
                    {
                        "row": index,
                        "field": "stock_item",
                        "message": "Already listed in this count.",
                    }
                )
                continue
            seen_ids.add(item.id)
            data["stock_item"] = item
            entry_unit = data.pop("entry_unit", None)
            if data["counted_qty"] is not None:
                try:
                    data["counted_qty"] = convert_entry_quantity(
                        data["counted_qty"], entry_unit, item
                    )
                except UnitEntryError as exc:
                    row_errors.append({"row": index, "field": "entry_unit", "message": str(exc)})
                    continue
            cleaned.append(data)

        if seen_ids != set(active_items):
            row_errors.append(
                {
                    "row": 0,
                    "field": "lines",
                    "message": "Every stock item must be counted or skipped.",
                }
            )

        if row_errors:
            raise CountValidationError(row_errors)

        needs_confirmation_ids = [
            data["stock_item"].id
            for data in cleaned
            if data["stock_item"].id not in confirm_ids
            and _is_unusual(business, data["stock_item"], data.get("counted_qty"), now)
        ]
        if needs_confirmation_ids:
            raise NeedsConfirmation(needs_confirmation_ids)

        deadline_at = deadline_at_for(business, business_date, count_type)
        # Step 23d: a business's first-ever count is allowed at any time of day — never late.
        is_late = now > deadline_at and not is_first_count
        minutes_late = int((now - deadline_at).total_seconds() // 60) if is_late else 0

        with transaction.atomic():
            count = StockCount.objects.create(
                business=business,
                count_type=count_type,
                business_date=business_date,
                counted_by=request.user,
                deadline_at=deadline_at,
                is_late=is_late,
                minutes_late=minutes_late,
                missing_opening=missing_opening,
            )
            CountLine.objects.bulk_create(
                [
                    CountLine(
                        count=count,
                        stock_item=data["stock_item"],
                        counted_qty=data["counted_qty"],
                        state=data["state"],
                        confirmed_unusual=data["stock_item"].id in confirm_ids,
                    )
                    for data in cleaned
                ]
            )

        log_action(
            user=request.user,
            action="count.create",
            business=business,
            count_id=count.id,
            count_type=count_type,
            business_date=str(business_date),
            is_late=is_late,
            minutes_late=minutes_late,
            missing_opening=missing_opening,
            items_counted=sum(1 for d in cleaned if d["state"] == CountLineState.COUNTED),
            items_skipped=sum(1 for d in cleaned if d["state"] == CountLineState.SKIPPED),
            items_not_sure=sum(1 for d in cleaned if d["state"] == CountLineState.NOT_SURE),
        )
        return Response(StockCountSerializer(count).data, status=201)


class CountDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id, count_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "counts.review")
        count = get_object_or_404(
            StockCount.objects.select_related("counted_by"), id=count_id, business=business
        )
        result_lines = lines_with_gap(business, count)

        # Step 14: a gap-flagged line surfaces first, then not-sure/confirmed-unusual, then the rest.
        def sort_key(line):
            if line["flagged"]:
                return 0
            if line["state"] == CountLineState.NOT_SURE or line["confirmed_unusual"]:
                return 1
            return 2

        result_lines.sort(key=sort_key)

        return Response({**StockCountSerializer(count).data, "lines": result_lines})


class CountRemindView(APIView):
    """Owner only. Returns a prepared wa.me link and message — never the mobile number as its own
    field, even though the link itself necessarily embeds it (that's how a wa.me link works)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        owner_access_or_403(business, request.user)

        count_type = request.data.get("type")
        if count_type not in CountType.values:
            raise ValidationError({"type": "Choose opening or closing."})
        user_id = request.data.get("user_id")
        access = (
            Access.objects.filter(business=business, user_id=user_id).select_related("user").first()
        )
        if access is None:
            raise Http404()

        name = access.user.name or "there"
        label = CountType(count_type).label.lower()
        message = (
            f"Hi {name}, the {label} stock count is still pending. Please complete it when you can."
        )
        wa_link = f"https://wa.me/91{access.user.mobile}?text={quote(message)}"

        log_action(
            user=request.user,
            action="count.remind",
            business=business,
            access_id=access.id,
            count_type=count_type,
        )
        return Response({"wa_link": wa_link, "message": message})


class TodayView(APIView):
    """One role-shaped snapshot of "today" — opening/closing count status (Step 23b's
    today_status.status_for), and how many wastage entries exist. No money anywhere in this
    response, for any role."""

    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        access = access_or_403(business, request.user)
        permissions = permissions_for(access.role)

        now = timezone.now()
        today_status = status_for(business, now)
        business_date = today_status["business_date"]

        def day_bounds():
            # The business day itself runs day_starts_hour -> day_starts_hour, not midnight ->
            # midnight — business_date already accounts for the shift, so the window anchored to
            # it must too, or "today" wastage near midnight would land in the wrong bucket.
            tz = ZoneInfo(business.timezone)
            start = datetime.combine(
                business_date, time(hour=business.settings.day_starts_hour), tzinfo=tz
            )
            return start, start + timedelta(days=1)

        start, end = day_bounds()
        wastage_qs = WastageEntry.objects.filter(
            business=business, is_deleted=False, recorded_at__gte=start, recorded_at__lt=end
        )
        if "wastage.view_own" in permissions and "wastage.view_all" not in permissions:
            wastage_qs = wastage_qs.filter(recorded_by=request.user)

        data = {
            "opening": today_status["opening"],
            "closing": today_status["closing"],
            "next_action": today_status["next_action"],
            "is_first_count": today_status["is_first_count"],
            "wastage_entries_today": wastage_qs.count(),
        }

        # Team-wide counted-item progress — gated separately from counts.create: Head chef can see
        # how the team as a whole is doing, Helper only ever sees their own task.
        if "counts.status" in permissions:
            counted_item_ids = set(
                CountLine.objects.filter(
                    count__business=business,
                    count__business_date=business_date,
                    state=CountLineState.COUNTED,
                ).values_list("stock_item_id", flat=True)
            )
            data["team_progress"] = {
                "counted": len(counted_item_ids),
                "total": business.stock_items.filter(active=True).count(),
            }

        # Step 15: Owner/Manager only, same as the Alerts screen itself.
        if "alerts.view" in permissions:
            data["alerts_count"] = len(open_alerts(business, access.role))

        return Response(data)


class CountsTodayStatusView(APIView):
    """Step 23b: the focused opening/closing status the Count screen drives itself from — no
    wastage/alerts/team numbers, no stock quantities, just locked/due/late/done and next_action.
    Open to counts.create or counts.review, the two permissions that between them cover every role
    that can ever see a count."""

    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        access = access_or_403(business, request.user)
        if not permissions_for(access.role) & {"counts.create", "counts.review"}:
            raise PermissionDenied()

        return Response(status_for(business))
