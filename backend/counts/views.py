from datetime import datetime, time, timedelta
from decimal import Decimal
from urllib.parse import quote
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Sum
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.log import log_action
from businesses.access import owner_access_or_403
from businesses.models import Access, Business
from businesses.permissions import access_or_403, permissions_for, require_permission
from purchases.models import PurchaseLine
from sales.models import Sale
from stock.models import SellItem
from wastage.models import WastageEntry

from .config import (
    UNUSUAL_VALUE_LOOKBACK_COUNTS,
    UNUSUAL_VALUE_LOOKBACK_DAYS,
    UNUSUAL_VALUE_MULTIPLIER,
)
from .exceptions import CountValidationError, DuplicateCount, NeedsConfirmation
from .models import CountLine, CountLineState, CountType, StockCount
from .serializers import CountCreateSerializer, CountLineRowSerializer, StockCountSerializer

ZERO = Decimal("0")


def _unit_cost_for(stock_item) -> Decimal | None:
    """The item's last purchase price, falling back to its usual price, else None — same rule
    wastage/views.py uses for unit_cost_at_entry, duplicated here rather than imported since that
    one is captured once at entry time and this one is computed fresh on every read."""
    last_line = (
        PurchaseLine.objects.filter(stock_item=stock_item, purchase__is_deleted=False)
        .order_by("-purchase__purchase_date_time", "-id")
        .first()
    )
    if last_line is not None:
        return last_line.unit_price
    return stock_item.usual_price


def _gap_window(prev_count: StockCount, count: StockCount) -> tuple[object, object]:
    """The business-date range sales are compared over — from the previous count (its own date, or
    the day after, depending on whether it was an opening or closing count) to this count (its own
    date, or the day before). Can end up inverted (e.g. a closing count immediately followed by next
    morning's opening count) — that's a legitimately empty window, not an error; the caller's date
    range ends up empty too."""
    window_start = (
        prev_count.business_date
        if prev_count.count_type == CountType.OPENING
        else prev_count.business_date + timedelta(days=1)
    )
    window_end = (
        count.business_date
        if count.count_type == CountType.CLOSING
        else count.business_date - timedelta(days=1)
    )
    return window_start, window_end


def _gap_for_line(
    business: Business,
    stock_item,
    used_since_last_count: Decimal | None,
    prev_count: StockCount | None,
    count: StockCount,
    gap_alert_pct: Decimal,
) -> dict:
    """Step 14: expected_used/gap_qty/gap_value/gap_status/gap_reason for one count line. Owner and
    Manager only — gated upstream by CountDetailView's own counts.review check, since Head chef and
    Helper have no permission to reach this endpoint at all."""
    empty = {
        "expected_used": None,
        "gap_qty": None,
        "gap_value": None,
        "gap_status": "not_comparable",
        "gap_reason": None,
        "flagged": False,
    }
    if prev_count is None or used_since_last_count is None:
        return {**empty, "gap_reason": {"code": "no_previous_count"}}

    sell_items = list(
        SellItem.objects.filter(business=business, active=True, main_stock_item=stock_item)
    )
    if not sell_items:
        return {**empty, "gap_reason": {"code": "not_sold"}}

    missing_uses = [item for item in sell_items if item.uses_qty is None]
    if missing_uses:
        return {**empty, "gap_reason": {"code": "uses_not_set", "count": len(missing_uses)}}

    window_start, window_end = _gap_window(prev_count, count)
    window_dates = []
    if window_end >= window_start:
        window_dates = [
            window_start + timedelta(days=i) for i in range((window_end - window_start).days + 1)
        ]

    if window_dates:
        sale_dates = set(
            Sale.objects.filter(
                business=business,
                is_deleted=False,
                business_date__gte=window_start,
                business_date__lte=window_end,
            ).values_list("business_date", flat=True)
        )
        missing_dates = [d for d in window_dates if d not in sale_dates]
        if missing_dates:
            return {
                **empty,
                "gap_reason": {
                    "code": "sales_missing",
                    "dates": [d.isoformat() for d in missing_dates],
                },
            }

    expected_used = ZERO
    for item in sell_items:
        units_sold = (
            Sale.objects.filter(
                business=business,
                sell_item=item,
                is_deleted=False,
                business_date__gte=window_start,
                business_date__lte=window_end,
            ).aggregate(total=Sum("quantity"))["total"]
            or ZERO
        )
        expected_used += units_sold * item.uses_qty

    gap_qty = used_since_last_count - expected_used
    unit_cost = _unit_cost_for(stock_item)
    gap_value = gap_qty * unit_cost if unit_cost is not None else None
    threshold = (gap_alert_pct / Decimal("100")) * expected_used
    flagged = abs(gap_qty) > threshold

    return {
        "expected_used": expected_used,
        "gap_qty": gap_qty,
        "gap_value": gap_value,
        "gap_status": "ok",
        "gap_reason": None,
        "flagged": flagged,
    }


def _business_today(business: Business):
    tz = ZoneInfo(business.timezone)
    return timezone.localtime(timezone.now(), tz).date()


def _deadline_at(business: Business, business_date, count_type: str):
    tz = ZoneInfo(business.timezone)
    hour = (
        business.settings.count_deadline_hour
        if count_type == CountType.OPENING
        else business.settings.closing_count_hour
    )
    return datetime.combine(business_date, time(hour=hour), tzinfo=tz)


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

        business_date = request.query_params.get("date") or _business_today(business).isoformat()
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
                        1 for line in _lines_with_gap(business, count) if line["flagged"]
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

        business_date = _business_today(business)
        if StockCount.objects.filter(
            business=business, count_type=count_type, business_date=business_date
        ).exists():
            raise DuplicateCount()

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

        now = timezone.now()
        needs_confirmation_ids = [
            data["stock_item"].id
            for data in cleaned
            if data["stock_item"].id not in confirm_ids
            and _is_unusual(business, data["stock_item"], data.get("counted_qty"), now)
        ]
        if needs_confirmation_ids:
            raise NeedsConfirmation(needs_confirmation_ids)

        deadline_at = _deadline_at(business, business_date, count_type)
        is_late = now > deadline_at
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
            items_counted=sum(1 for d in cleaned if d["state"] == CountLineState.COUNTED),
            items_skipped=sum(1 for d in cleaned if d["state"] == CountLineState.SKIPPED),
            items_not_sure=sum(1 for d in cleaned if d["state"] == CountLineState.NOT_SURE),
        )
        return Response(StockCountSerializer(count).data, status=201)


def _lines_with_gap(business: Business, count: StockCount) -> list[dict]:
    """Every line of `count` with its used-since-last-count and (Step 14) stock-gap fields — shared
    by CountDetailView (the full lines) and CountListCreateView (just the flagged count), so the two
    never compute this differently."""
    lines = count.lines.select_related("stock_item").all()
    gap_alert_pct = business.settings.gap_alert_pct

    result_lines = []
    for line in lines:
        prev_line = (
            CountLine.objects.filter(
                stock_item=line.stock_item,
                count__business=business,
                state=CountLineState.COUNTED,
                count__submitted_at__lt=count.submitted_at,
            )
            .exclude(count=count)
            .select_related("count")
            .order_by("-count__submitted_at")
            .first()
        )
        previous_qty = prev_line.counted_qty if prev_line else None
        bought = wasted = None
        used_since_last_count = None
        if prev_line is not None and line.counted_qty is not None:
            window_start = prev_line.count.submitted_at
            window_end = count.submitted_at
            bought = (
                PurchaseLine.objects.filter(
                    stock_item=line.stock_item,
                    purchase__business=business,
                    purchase__is_deleted=False,
                    purchase__purchase_date_time__gt=window_start,
                    purchase__purchase_date_time__lte=window_end,
                ).aggregate(total=Sum("quantity"))["total"]
                or ZERO
            )
            wasted = (
                WastageEntry.objects.filter(
                    stock_item=line.stock_item,
                    business=business,
                    is_deleted=False,
                    recorded_at__gt=window_start,
                    recorded_at__lte=window_end,
                ).aggregate(total=Sum("quantity"))["total"]
                or ZERO
            )
            used_since_last_count = previous_qty + bought - wasted - line.counted_qty

        gap = _gap_for_line(
            business,
            line.stock_item,
            used_since_last_count,
            prev_line.count if prev_line else None,
            count,
            gap_alert_pct,
        )

        result_lines.append(
            {
                "id": line.id,
                "stock_item": line.stock_item_id,
                "stock_item_name": line.stock_item.name,
                "unit": line.stock_item.unit,
                "state": line.state,
                "counted_qty": line.counted_qty,
                "confirmed_unusual": line.confirmed_unusual,
                "previous_counted_qty": previous_qty,
                "quantity_bought_since": bought,
                "quantity_wasted_since": wasted,
                "used_since_last_count": used_since_last_count,
                **gap,
            }
        )
    return result_lines


class CountDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id, count_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "counts.review")
        count = get_object_or_404(
            StockCount.objects.select_related("counted_by"), id=count_id, business=business
        )
        result_lines = _lines_with_gap(business, count)

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
    """One role-shaped snapshot of "today" — opening/closing count state, the deadline times, and
    how many wastage entries exist. No money anywhere in this response, for any role."""

    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        access = access_or_403(business, request.user)
        permissions = permissions_for(access.role)

        business_date = _business_today(business)
        counts_today = {
            c.count_type: c
            for c in StockCount.objects.filter(business=business, business_date=business_date)
        }

        def state_for(count_type: str) -> str:
            # "done" once submitted, regardless of whether that submission itself landed after the
            # deadline (StockCount.is_late/minutes_late still records that fact for count review).
            # Before submission, "late" means the deadline has already passed with nothing
            # submitted yet — the real "needs attention" case Home's alert is for; "not_started"
            # alone would never fire an alert before anyone had a chance to act.
            if count_type in counts_today:
                return "done"
            deadline = _deadline_at(business, business_date, count_type)
            return "late" if timezone.now() > deadline else "not_started"

        def day_bounds():
            tz = ZoneInfo(business.timezone)
            start = datetime.combine(business_date, time.min, tzinfo=tz)
            return start, start + timedelta(days=1)

        start, end = day_bounds()
        wastage_qs = WastageEntry.objects.filter(
            business=business, is_deleted=False, recorded_at__gte=start, recorded_at__lt=end
        )
        if "wastage.view_own" in permissions and "wastage.view_all" not in permissions:
            wastage_qs = wastage_qs.filter(recorded_by=request.user)

        data = {
            "opening": {
                "state": state_for(CountType.OPENING),
                "deadline_at": _deadline_at(business, business_date, CountType.OPENING),
            },
            "closing": {
                "state": state_for(CountType.CLOSING),
                "deadline_at": _deadline_at(business, business_date, CountType.CLOSING),
            },
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

        return Response(data)
