"""Step 14's stock-gap math, pulled out of views.py so Step 15's alerts app can reuse the exact
same computation for the gap_flagged alert type instead of a second implementation."""

from datetime import timedelta
from decimal import Decimal

from django.db.models import Sum

from businesses.models import Business
from purchases.models import PurchaseLine
from sales.models import Sale
from stock.models import SellItem
from wastage.models import WastageEntry

from .models import CountLine, CountLineState, CountType, StockCount

ZERO = Decimal("0")


def unit_cost_for(stock_item) -> Decimal | None:
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


def gap_window(prev_count: StockCount, count: StockCount) -> tuple[object, object]:
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


def gap_for_line(
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

    window_start, window_end = gap_window(prev_count, count)
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
    unit_cost = unit_cost_for(stock_item)
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


def lines_with_gap(business: Business, count: StockCount) -> list[dict]:
    """Every line of `count` with its used-since-last-count and (Step 14) stock-gap fields — shared
    by CountDetailView/CountListCreateView (the full lines) and (Step 15) the alerts app's
    gap_flagged alert, so none of them ever compute this differently."""
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

        gap = gap_for_line(
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
