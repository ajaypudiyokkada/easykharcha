"""Step 41b1b3a (docs/BASES_PLAN.md sec 8.3): low-stock thresholds, "estimated stock now" and the
shopping-list read path — one module shared by the thresholds endpoint, alerts/service.py's
low_stock alert and the low-stock/shopping-list view, so none of them compute it differently (same
discipline as counts/gap.py's lines_with_gap / stock/base_expansion.py's one-level expansion).

Pure read/aggregation, no state."""

from datetime import timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db.models import Sum
from django.utils import timezone

from businesses.models import Business
from counts.models import CountLine, CountLineState
from purchases.models import PurchaseLine
from sales.models import Sale
from wastage.models import WastageEntry

from .base_expansion import quantity_per_portion_by_sell_item
from .models import LowStockCategory, RecipeStatus, StockItem

ZERO = Decimal("0")
HUNDRED = Decimal("100")
USAGE_WINDOW_DAYS = 14

# Step 41b1b3a spec: category -> default days of cover. A per-item `low_stock_days_override`
# replaces this for one item; FRESH_SEMI/PACKAGING_CLEANING are never inferred automatically (see
# LowStockCategory's docstring) — only PERISHABLE/DRY_STAPLES are, from `goes_off`.
LOW_STOCK_CATEGORY_DEFAULT_DAYS: dict[str, int] = {
    LowStockCategory.PERISHABLE: 1,
    LowStockCategory.FRESH_SEMI: 3,
    LowStockCategory.DRY_STAPLES: 7,
    LowStockCategory.PACKAGING_CLEANING: 14,
}


def default_category_for(goes_off: bool) -> str:
    """A new stock item's starting `low_stock_category`, from its `goes_off` toggle — same binary
    split the base-unit backfill already draws from `goes_off`. An Owner/Manager can change it
    (including to FRESH_SEMI/PACKAGING_CLEANING) via the thresholds endpoint afterward."""
    return LowStockCategory.PERISHABLE if goes_off else LowStockCategory.DRY_STAPLES


def days_of_cover(stock_item: StockItem) -> int:
    if stock_item.low_stock_days_override is not None:
        return stock_item.low_stock_days_override
    return LOW_STOCK_CATEGORY_DEFAULT_DAYS[stock_item.low_stock_category]


def _business_today(business: Business):
    return timezone.localtime(timezone.now(), ZoneInfo(business.timezone)).date()


def _expected_usage_breakdown(
    business: Business, stock_item: StockItem, window_start, window_end
) -> tuple[Decimal, Decimal]:
    """(confirmed_expected, unconfirmed_expected) stock-item usage from sales between
    window_start/window_end (business_date, inclusive) — the same confirmed/unconfirmed split
    counts/gap.py's gap_for_line uses, computed once here so an estimate and the coverage share it
    rests on come from one query pass."""
    if window_end < window_start:
        return ZERO, ZERO

    quantity_by_sell_item = quantity_per_portion_by_sell_item(business, stock_item)
    confirmed_expected = ZERO
    unconfirmed_expected = ZERO
    for sell_item, qty_per_portion in quantity_by_sell_item.items():
        if sell_item.recipe_status not in (RecipeStatus.CONFIRMED, RecipeStatus.UNCONFIRMED):
            continue
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
        contribution = units_sold * qty_per_portion
        if sell_item.recipe_status == RecipeStatus.CONFIRMED:
            confirmed_expected += contribution
        else:
            unconfirmed_expected += contribution
    return confirmed_expected, unconfirmed_expected


def avg_daily_expected_usage(business: Business, stock_item: StockItem, as_of_date) -> Decimal:
    """Confirmed-recipe expected usage of `stock_item`, averaged over the last 14 business days
    ending `as_of_date` (inclusive) — the figure a days-of-cover threshold is measured against.
    Zero, not None, when there's simply been no confirmed-recipe usage in the window."""
    window_start = as_of_date - timedelta(days=USAGE_WINDOW_DAYS - 1)
    confirmed_expected, _ = _expected_usage_breakdown(
        business, stock_item, window_start, as_of_date
    )
    return confirmed_expected / Decimal(USAGE_WINDOW_DAYS)


def effective_threshold(stock_item: StockItem, avg_daily_usage: Decimal) -> Decimal | None:
    """The larger of the fixed minimum and days-of-cover x average daily expected usage. None if
    there's no usage data yet AND no fixed minimum set — nothing to compare "estimated stock now"
    against, so no low-stock evaluation is possible for this item yet."""
    fixed = stock_item.low_stock_fixed_qty or ZERO
    if avg_daily_usage <= ZERO:
        return fixed if fixed > ZERO else None
    days_based = Decimal(days_of_cover(stock_item)) * avg_daily_usage
    return max(fixed, days_based)


def estimated_stock_now(business: Business, stock_item: StockItem, as_of=None) -> dict | None:
    """last count + purchases since - wastage since - expected usage since (confirmed-recipe only,
    coverage-aware: unconfirmed/no-recipe usage counts as zero so the estimate never *overstates*
    available stock). None if this item has never been counted — there's no baseline to estimate
    from at all."""
    as_of = as_of or timezone.now()
    last_line = (
        CountLine.objects.filter(stock_item=stock_item, state=CountLineState.COUNTED)
        .select_related("count")
        .order_by("-count__submitted_at", "-id")
        .first()
    )
    if last_line is None or last_line.counted_qty is None:
        return None

    since = last_line.count.submitted_at
    purchased = (
        PurchaseLine.objects.filter(
            stock_item=stock_item,
            purchase__is_deleted=False,
            purchase__purchase_date_time__gt=since,
            purchase__purchase_date_time__lte=as_of,
        ).aggregate(total=Sum("quantity"))["total"]
        or ZERO
    )
    wasted = (
        WastageEntry.objects.filter(
            stock_item=stock_item,
            is_deleted=False,
            recorded_at__gt=since,
            recorded_at__lte=as_of,
        ).aggregate(total=Sum("quantity"))["total"]
        or ZERO
    )

    tz = ZoneInfo(business.timezone)
    window_start = timezone.localtime(since, tz).date()
    window_end = timezone.localtime(as_of, tz).date()
    confirmed_expected, unconfirmed_expected = _expected_usage_breakdown(
        business, stock_item, window_start, window_end
    )
    denominator = confirmed_expected + unconfirmed_expected
    coverage_pct = (confirmed_expected / denominator) * HUNDRED if denominator > ZERO else None

    estimate = last_line.counted_qty + purchased - wasted - confirmed_expected
    return {
        "estimate": estimate,
        "is_estimate": True,
        "coverage_pct": coverage_pct,
        "last_counted_at": last_line.count.submitted_at,
    }


def low_stock_rows(business: Business) -> list[dict]:
    """Every active stock item currently below its effective threshold — the one computation the
    low_stock alert and the shopping-list endpoint both read, so the two never disagree. Each row
    includes `suggested_order_qty`: enough to reach (days of cover + 1 day) of average usage, or
    (when there's no usage data to project from) enough to clear the fixed-minimum threshold."""
    today = _business_today(business)
    rows = []
    for item in business.stock_items.filter(active=True):
        estimate_info = estimated_stock_now(business, item)
        if estimate_info is None:
            continue
        avg_daily_usage = avg_daily_expected_usage(business, item, today)
        threshold = effective_threshold(item, avg_daily_usage)
        if threshold is None:
            continue
        estimate = estimate_info["estimate"]
        if estimate >= threshold:
            continue

        if avg_daily_usage > ZERO:
            target = Decimal(days_of_cover(item) + 1) * avg_daily_usage
        else:
            target = threshold
        suggested_order_qty = max(target - estimate, ZERO)

        rows.append(
            {
                "stock_item": item,
                "estimate": estimate,
                "threshold": threshold,
                "is_estimate": estimate_info["is_estimate"],
                "coverage_pct": estimate_info["coverage_pct"],
                "suggested_order_qty": suggested_order_qty,
            }
        )
    return rows
