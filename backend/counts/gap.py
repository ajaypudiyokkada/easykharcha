"""Step 14's stock-gap math, pulled out of views.py so Step 15's alerts app can reuse the exact
same computation for the gap_flagged alert type instead of a second implementation."""

from datetime import timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db.models import Sum
from django.utils import timezone

from businesses.models import Business
from purchases.models import PurchaseLine
from sales.models import Sale
from stock.base_expansion import quantity_per_portion_by_sell_item
from stock.models import RecipeStatus
from stock.units import display_quantities
from wastage.models import WastageEntry

from .models import CountLine, CountLineState, CountType, StockCount

ZERO = Decimal("0")
HUNDRED = Decimal("100")
# U2b1b1 (docs/BASES_PLAN.md secs 1-2): below this, the recipe picture is too thin to trust at
# all — same "not compared" shape the old all-or-nothing not_confirmed check used.
COVERAGE_NOT_COMPARABLE_PCT = Decimal("40")
# At/above this, a line is "real" (alert-eligible, tolerance widened by how far under 100% it
# is); between the two it's shown but never alerted on.
COVERAGE_REAL_GAP_PCT = Decimal("70")


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


def _local_date(business: Business, at):
    """The plain business-timezone calendar date `at` falls on — the same unshifted notion of
    "date" a Sale's own business_date is recorded under (sales/views.py's `_business_today`),
    unlike StockCount.business_date, which is shifted by day_starts_hour."""
    return timezone.localtime(at, ZoneInfo(business.timezone)).date()


def gap_window(
    business: Business, prev_count: StockCount, count: StockCount
) -> tuple[object, object]:
    """The date range sales are compared over — from the previous count (its own date, or the day
    after, depending on whether it was an opening or closing count) to this count (its own date, or
    the day before). Built from each count's submitted_at, not its (possibly day_starts_hour-
    shifted) business_date: a Sale's own business_date is always the plain calendar date it was
    recorded under, so matching against the counts' plain calendar dates is what keeps a late-night
    count (e.g. a closing at 01:00, business_date the previous day) lined up with same-night sales
    recorded under the next calendar date — otherwise that night's sales fall outside the window and
    expected_used comes out short. Can end up inverted (e.g. a closing count immediately followed by
    next morning's opening count) — that's a legitimately empty window, not an error; the caller's
    date range ends up empty too."""
    prev_date = _local_date(business, prev_count.submitted_at)
    count_date = _local_date(business, count.submitted_at)
    window_start = (
        prev_date if prev_count.count_type == CountType.OPENING else prev_date + timedelta(days=1)
    )
    window_end = (
        count_date if count.count_type == CountType.CLOSING else count_date - timedelta(days=1)
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
        "coverage_pct": None,
        "gap_tolerance_pct": None,
    }
    if prev_count is None or used_since_last_count is None:
        return {**empty, "gap_reason": {"code": "no_previous_count"}}

    # U2b1b2 (docs/BASES_PLAN.md secs 1-2, 8.2): per sell item, how much of this stock item one
    # portion uses — already folding in both a dish's own direct ingredient line and, one level
    # down, every base it uses that contains this stock item. The rest of this function (sales
    # lookup, confirmed/unconfirmed split, expected_used sum) doesn't care which path it came from.
    quantity_by_sell_item = quantity_per_portion_by_sell_item(business, stock_item)
    if not quantity_by_sell_item:
        return {**empty, "gap_reason": {"code": "not_sold"}}

    # U2b1b1 (docs/BASES_PLAN.md secs 1-2): a dish whose recipe isn't confirmed (a future AI
    # estimate still awaiting review) no longer blocks this stock item outright — its expected
    # usage counts toward the coverage split below instead, same "at least one real line" spirit
    # as before but graduated instead of all-or-nothing. A NONE-status dish never reaches here at
    # all: it has no ingredient/base rows by construction (RecipeStatus's own docstring), so it
    # never contributes to either sum.
    confirmed_items = {
        sell_item: qty
        for sell_item, qty in quantity_by_sell_item.items()
        if sell_item.recipe_status == RecipeStatus.CONFIRMED
    }
    unconfirmed_items = {
        sell_item: qty
        for sell_item, qty in quantity_by_sell_item.items()
        if sell_item.recipe_status == RecipeStatus.UNCONFIRMED
    }

    window_start, window_end = gap_window(business, prev_count, count)
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

    def _expected(items: dict) -> Decimal:
        total = ZERO
        for sell_item, qty_per_portion in items.items():
            units_sold = (
                Sale.objects.filter(
                    business=business,
                    sell_item=sell_item,
                    is_deleted=False,
                    business_date__gte=window_start,
                    business_date__lte=window_end,
                ).aggregate(total=Sum("quantity"))["total"]
                or ZERO
            )
            total += units_sold * qty_per_portion
        return total

    confirmed_expected = _expected(confirmed_items)
    unconfirmed_expected = _expected(unconfirmed_items)
    denominator = confirmed_expected + unconfirmed_expected
    if denominator == ZERO:
        return {**empty, "gap_reason": {"code": "low_recipe_coverage", "coverage_pct": None}}

    coverage_pct = (confirmed_expected / denominator) * HUNDRED
    if coverage_pct < COVERAGE_NOT_COMPARABLE_PCT:
        return {
            **empty,
            "gap_reason": {"code": "low_recipe_coverage", "coverage_pct": coverage_pct},
        }

    # Below COVERAGE_REAL_GAP_PCT the figure is shown (indicative) but never alerted on, so the
    # gap/tolerance numbers are still computed against confirmed_expected only — unconfirmed
    # recipes only ever widen the coverage denominator, never the expected-usage target itself.
    expected_used = confirmed_expected
    gap_qty = used_since_last_count - expected_used
    unit_cost = unit_cost_for(stock_item)
    gap_value = gap_qty * unit_cost if unit_cost is not None else None

    if coverage_pct >= COVERAGE_REAL_GAP_PCT:
        gap_tolerance_pct = gap_alert_pct * (HUNDRED / coverage_pct)
        threshold = (gap_tolerance_pct / HUNDRED) * expected_used
        return {
            "expected_used": expected_used,
            "gap_qty": gap_qty,
            "gap_value": gap_value,
            "gap_status": "ok",
            "gap_reason": None,
            "flagged": abs(gap_qty) > threshold,
            "coverage_pct": coverage_pct,
            "gap_tolerance_pct": gap_tolerance_pct,
        }

    return {
        "expected_used": expected_used,
        "gap_qty": gap_qty,
        "gap_value": gap_value,
        "gap_status": "indicative",
        "gap_reason": None,
        "flagged": False,
        "coverage_pct": coverage_pct,
        "gap_tolerance_pct": None,
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

        # U1b-3b-3: every quantity on this line rolled up onto one shared display unit (the
        # biggest of them decides kg/L vs g/ml, same rule display_quantities uses for the
        # wastage/gap alerts above) — base values are kept alongside, untouched, for anything
        # still doing its own maths against them.
        display, display_unit = display_quantities(
            {
                "counted_qty": line.counted_qty,
                "previous_counted_qty": previous_qty,
                "quantity_bought_since": bought,
                "quantity_wasted_since": wasted,
                "used_since_last_count": used_since_last_count,
                "expected_used": gap["expected_used"],
                "gap_qty": gap["gap_qty"],
            },
            line.stock_item.unit,
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
                "display_unit": display_unit,
                "display_counted_qty": display["counted_qty"],
                "display_previous_counted_qty": display["previous_counted_qty"],
                "display_quantity_bought_since": display["quantity_bought_since"],
                "display_quantity_wasted_since": display["quantity_wasted_since"],
                "display_used_since_last_count": display["used_since_last_count"],
                "display_expected_used": display["expected_used"],
                "display_gap_qty": display["gap_qty"],
            }
        )
    return result_lines
