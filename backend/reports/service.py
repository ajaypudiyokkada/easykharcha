"""Step 16: the six Reports blocks, computed on read — no stored report rows, same philosophy as
alerts/service.py. Purchases and wastage are aggregated with one grouped query each (TruncDate in
the business's own timezone) and folded into buckets in Python; stock-gap figures reuse
counts.gap.lines_with_gap per closing count in the window (the one place gap math is allowed to
live) rather than a second implementation, so a report's gap number can never disagree with a
count's own gap column or an alert's gap_flagged figure.
"""

from collections import defaultdict
from datetime import datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db.models import F, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from businesses.models import Business
from counts.gap import lines_with_gap, unit_cost_for
from counts.models import CountType, StockCount
from purchases.models import Purchase, PurchaseLine
from sales.models import Sale
from stock.models import RecipeStatus
from wastage.models import WastageEntry

ZERO = Decimal("0")
PCT_PLACES = Decimal("0.1")
PERIOD_DAYS = {"today": 1, "7d": 7, "30d": 30, "90d": 90}
PRICE_TREND_MIN_POINTS = 2
TOP_USED_VS_EXPECTED = 6
TOP_BIGGEST_GAPS = 5


def _business_today(business: Business):
    tz = ZoneInfo(business.timezone)
    return timezone.localtime(timezone.now(), tz).date()


def _day_bounds(business: Business, date_):
    """The business-local midnight-to-midnight datetime range for one calendar date, in UTC-aware
    form — the shape every datetime-field filter below needs."""
    tz = ZoneInfo(business.timezone)
    start = datetime.combine(date_, time.min, tzinfo=tz)
    return start, start + timedelta(days=1)


def _window(business: Business, period: str):
    """(start_date, end_date, bucket_days) for a period key — unknown keys fall back to 7d, same
    tolerance as every other `?param=` on this API."""
    today = _business_today(business)
    days = PERIOD_DAYS.get(period, 7)
    start_date = today - timedelta(days=days - 1)
    bucket_days = 7 if period == "90d" else 1
    return start_date, today, bucket_days


def _buckets(start_date, end_date, bucket_days):
    buckets = []
    cursor = start_date
    while cursor <= end_date:
        bucket_end = min(cursor + timedelta(days=bucket_days - 1), end_date)
        buckets.append((cursor, bucket_end))
        cursor = bucket_end + timedelta(days=1)
    return buckets


def _sum_bucket(by_date: dict, bucket_start, bucket_end) -> Decimal:
    total = ZERO
    day = bucket_start
    while day <= bucket_end:
        total += by_date.get(day, ZERO)
        day += timedelta(days=1)
    return total


def _pct(numerator: Decimal, denominator: Decimal) -> str | None:
    if not denominator:
        return None
    return str(((numerator / denominator) * Decimal("100")).quantize(PCT_PLACES))


def _money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


def _bucket_label(start_date, end_date) -> dict:
    return {"start": start_date.isoformat(), "end": end_date.isoformat()}


def _purchases_by_date(business: Business, window_start, window_end_exclusive, tz) -> dict:
    rows = (
        Purchase.objects.filter(
            business=business,
            is_deleted=False,
            purchase_date_time__gte=window_start,
            purchase_date_time__lt=window_end_exclusive,
        )
        .annotate(date=TruncDate("purchase_date_time", tzinfo=tz))
        .values("date")
        .annotate(total=Sum("total_amount"))
    )
    return {row["date"]: row["total"] or ZERO for row in rows}


def _wastage_value_by_date(business: Business, window_start, window_end_exclusive, tz) -> dict:
    rows = (
        WastageEntry.objects.filter(
            business=business,
            is_deleted=False,
            unit_cost_at_entry__isnull=False,
            recorded_at__gte=window_start,
            recorded_at__lt=window_end_exclusive,
        )
        .annotate(date=TruncDate("recorded_at", tzinfo=tz))
        .values("date")
        .annotate(total=Sum(F("quantity") * F("unit_cost_at_entry")))
    )
    return {row["date"]: row["total"] or ZERO for row in rows}


def _wastage_qty_by_date_unit(business: Business, window_start, window_end_exclusive, tz) -> dict:
    rows = (
        WastageEntry.objects.filter(
            business=business,
            is_deleted=False,
            recorded_at__gte=window_start,
            recorded_at__lt=window_end_exclusive,
        )
        .annotate(date=TruncDate("recorded_at", tzinfo=tz))
        .values("date", "stock_item__unit")
        .annotate(total=Sum("quantity"))
    )
    by_date: dict = defaultdict(dict)
    for row in rows:
        by_date[row["date"]][row["stock_item__unit"]] = row["total"] or ZERO
    return by_date


def _closing_counts_gap_data(business: Business, window_start_date, window_end_date):
    """One pass over every closing count submitted in the window, reusing lines_with_gap (Step 14's
    shared gap math) per count — the same per-count query pattern CountDetailView and alerts'
    gap_flagged already use, just run across a date range instead of a single count."""
    gap_value_by_date: dict = defaultdict(lambda: ZERO)
    per_item: dict = {}

    closing_counts = StockCount.objects.filter(
        business=business,
        count_type=CountType.CLOSING,
        business_date__gte=window_start_date,
        business_date__lte=window_end_date,
    ).order_by("business_date")

    for count in closing_counts:
        for line in lines_with_gap(business, count):
            if line["gap_status"] != "ok":
                continue
            entry = per_item.setdefault(
                line["stock_item"],
                {
                    "stock_item": line["stock_item"],
                    "name": line["stock_item_name"],
                    "unit": line["unit"],
                    "used": ZERO,
                    "expected": ZERO,
                    "gap_qty": ZERO,
                    "gap_value": ZERO,
                    "flagged_gap_qty_abs": ZERO,
                    "flagged_gap_value_abs": ZERO,
                },
            )
            entry["used"] += line["used_since_last_count"] or ZERO
            entry["expected"] += line["expected_used"] or ZERO
            gap_qty = line["gap_qty"] or ZERO
            gap_value = line["gap_value"] or ZERO
            entry["gap_qty"] += gap_qty
            entry["gap_value"] += gap_value
            if line["flagged"]:
                entry["flagged_gap_qty_abs"] += abs(gap_qty)
                entry["flagged_gap_value_abs"] += abs(gap_value)
                if gap_value > ZERO:
                    gap_value_by_date[count.business_date] += gap_value

    return gap_value_by_date, per_item


def _money_went(business, buckets, purchases_by_date, wastage_value_by_date, gap_value_by_date):
    rows = []
    total_bought = total_wastage = total_gap = ZERO
    for start, end in buckets:
        bought = _sum_bucket(purchases_by_date, start, end)
        wastage_value = _sum_bucket(wastage_value_by_date, start, end)
        gap_value = _sum_bucket(gap_value_by_date, start, end)
        total_bought += bought
        total_wastage += wastage_value
        total_gap += gap_value
        rows.append(
            {
                **_bucket_label(start, end),
                "bought": _money(bought),
                "wastage_value": _money(wastage_value),
                "gap_value": _money(gap_value),
            }
        )
    return {
        "buckets": rows,
        "total": {
            "bought": _money(total_bought),
            "wastage_value": _money(total_wastage),
            "gap_value": _money(total_gap),
        },
    }


def _used_vs_expected(per_item: dict):
    items = sorted(per_item.values(), key=lambda e: abs(e["gap_value"]), reverse=True)
    top = items[:TOP_USED_VS_EXPECTED]
    total_gap_value = sum((abs(e["gap_value"]) for e in top), ZERO)
    return {
        "items": [
            {
                "stock_item": e["stock_item"],
                "name": e["name"],
                "unit": e["unit"],
                "used": str(e["used"]),
                "expected": str(e["expected"]),
                "gap_qty": str(e["gap_qty"]),
                "gap_value": _money(e["gap_value"]),
            }
            for e in top
        ],
        "total_gap_value": _money(total_gap_value),
    }


def _biggest_gaps(per_item: dict):
    flagged = [e for e in per_item.values() if e["flagged_gap_value_abs"] > ZERO]
    flagged.sort(key=lambda e: e["flagged_gap_value_abs"], reverse=True)
    top = flagged[:TOP_BIGGEST_GAPS]
    return {
        "items": [
            {
                "stock_item": e["stock_item"],
                "name": e["name"],
                "quantity": str(e["flagged_gap_qty_abs"]),
                "unit": e["unit"],
                "value": _money(e["flagged_gap_value_abs"]),
            }
            for e in top
        ]
    }


def _wastage_trend(
    business, buckets, wastage_value_by_date, qty_by_date_unit, window_start_date, tz
):
    rows = []
    total_value = ZERO
    total_qty_by_unit: dict = defaultdict(lambda: ZERO)
    for start, end in buckets:
        value = _sum_bucket(wastage_value_by_date, start, end)
        total_value += value
        bucket_qty_by_unit: dict = defaultdict(lambda: ZERO)
        day = start
        while day <= end:
            for unit, qty in qty_by_date_unit.get(day, {}).items():
                bucket_qty_by_unit[unit] += qty
                total_qty_by_unit[unit] += qty
            day += timedelta(days=1)
        rows.append(
            {
                **_bucket_label(start, end),
                "value": _money(value),
                "quantity_by_unit": {unit: str(qty) for unit, qty in bucket_qty_by_unit.items()},
            }
        )

    period_days = (buckets[-1][1] - buckets[0][0]).days + 1 if buckets else 0
    previous_end = window_start_date - timedelta(days=1)
    previous_start = previous_end - timedelta(days=period_days - 1)
    prev_start_dt, _ = _day_bounds(business, previous_start)
    _, prev_end_dt = _day_bounds(business, previous_end)
    previous_value = (
        WastageEntry.objects.filter(
            business=business,
            is_deleted=False,
            unit_cost_at_entry__isnull=False,
            recorded_at__gte=prev_start_dt,
            recorded_at__lt=prev_end_dt,
        ).aggregate(total=Sum(F("quantity") * F("unit_cost_at_entry")))["total"]
        or ZERO
    )

    return {
        "buckets": rows,
        "total": {
            "value": _money(total_value),
            "quantity_by_unit": {unit: str(qty) for unit, qty in total_qty_by_unit.items()},
        },
        "change_pct": _pct(total_value - previous_value, previous_value),
    }


def _price_trend(business, window_start_dt, window_end_dt, requested_item_id):
    lines = list(
        PurchaseLine.objects.filter(
            stock_item__business=business,
            stock_item__active=True,
            purchase__is_deleted=False,
            purchase__purchase_date_time__gte=window_start_dt,
            purchase__purchase_date_time__lt=window_end_dt,
        )
        .select_related("stock_item", "purchase")
        .order_by("purchase__purchase_date_time", "id")
    )

    by_item: dict = defaultdict(list)
    for line in lines:
        by_item[line.stock_item_id].append(line)

    picker = []
    for stock_item_id, item_lines in by_item.items():
        if len(item_lines) < PRICE_TREND_MIN_POINTS:
            continue
        first_price = item_lines[0].unit_price
        last_price = item_lines[-1].unit_price
        pct_change = _pct(last_price - first_price, first_price)
        picker.append(
            {
                "id": stock_item_id,
                "name": item_lines[0].stock_item.name,
                "pct_change": pct_change,
            }
        )
    picker.sort(key=lambda e: Decimal(e["pct_change"] or "0"), reverse=True)

    chosen_id = requested_item_id
    if chosen_id is None and picker:
        chosen_id = picker[0]["id"]

    item = None
    points = []
    pct_change = None
    if chosen_id is not None:
        item_lines = by_item.get(chosen_id, [])
        if item_lines:
            stock_item = item_lines[0].stock_item
        else:
            # Requested by id but no purchases fell inside this period — still identify the item so
            # the picker and the empty-chart message both know what was asked for.
            stock_item = business.stock_items.filter(id=chosen_id, active=True).first()
        if stock_item is not None:
            item = {"id": stock_item.id, "name": stock_item.name, "unit": stock_item.unit}
            points = [
                {
                    "date": line.purchase.purchase_date_time.date().isoformat(),
                    "unit_price": str(line.unit_price),
                }
                for line in item_lines
            ]
            if len(item_lines) >= PRICE_TREND_MIN_POINTS:
                pct_change = _pct(
                    item_lines[-1].unit_price - item_lines[0].unit_price, item_lines[0].unit_price
                )

    return {"item": item, "points": points, "pct_change": pct_change, "items": picker}


def _sales_vs_cost(business, buckets, window_start_date, window_end_date):
    """Step 22a: a dish's cost is the sum of every confirmed ingredient's quantity x its own unit
    cost — only sell items with recipe_status=confirmed count toward `covered_amount` at all, same
    rule gap maths uses, so "what fraction of sales do we even know the cost of" stays honest."""
    sales = list(
        Sale.objects.filter(
            business=business,
            is_deleted=False,
            business_date__gte=window_start_date,
            business_date__lte=window_end_date,
        )
        .select_related("sell_item")
        .prefetch_related("sell_item__ingredients__stock_item")
    )

    sales_by_date: dict = defaultdict(lambda: ZERO)
    cost_by_date: dict = defaultdict(lambda: ZERO)
    total_amount = covered_amount = ZERO
    cost_cache: dict = {}

    for sale in sales:
        total_amount += sale.amount
        sales_by_date[sale.business_date] += sale.amount
        sell_item = sale.sell_item
        ingredients = list(sell_item.ingredients.all())
        if sell_item.recipe_status != RecipeStatus.CONFIRMED or not ingredients:
            continue

        unit_cost_per_portion = ZERO
        every_ingredient_costed = True
        for ingredient in ingredients:
            stock_item = ingredient.stock_item
            if stock_item.id not in cost_cache:
                cost_cache[stock_item.id] = unit_cost_for(stock_item)
            unit_cost = cost_cache[stock_item.id]
            if unit_cost is None:
                every_ingredient_costed = False
                break
            unit_cost_per_portion += ingredient.quantity * unit_cost

        if every_ingredient_costed:
            covered_amount += sale.amount
            cost_by_date[sale.business_date] += sale.quantity * unit_cost_per_portion

    rows = []
    total_cost = ZERO
    for start, end in buckets:
        sales_total = _sum_bucket(sales_by_date, start, end)
        cost_total = _sum_bucket(cost_by_date, start, end)
        total_cost += cost_total
        rows.append(
            {**_bucket_label(start, end), "sales": _money(sales_total), "cost": _money(cost_total)}
        )

    return {
        "buckets": rows,
        "total": {"sales": _money(total_amount), "cost": _money(total_cost)},
        "cost_pct": _pct(total_cost, total_amount),
        "target_cost_pct": str(business.settings.target_cost_pct),
        "coverage_pct": _pct(covered_amount, total_amount),
    }


def summary_for(business: Business, period: str, item_id: int | None) -> dict:
    tz = ZoneInfo(business.timezone)
    window_start_date, window_end_date, bucket_days = _window(business, period)
    buckets = _buckets(window_start_date, window_end_date, bucket_days)
    window_start_dt, _ = _day_bounds(business, window_start_date)
    _, window_end_dt = _day_bounds(business, window_end_date)

    purchases_by_date = _purchases_by_date(business, window_start_dt, window_end_dt, tz)
    wastage_value_by_date = _wastage_value_by_date(business, window_start_dt, window_end_dt, tz)
    wastage_qty_by_date_unit = _wastage_qty_by_date_unit(
        business, window_start_dt, window_end_dt, tz
    )
    gap_value_by_date, per_item = _closing_counts_gap_data(
        business, window_start_date, window_end_date
    )

    return {
        "period": period,
        "money_went": _money_went(
            business, buckets, purchases_by_date, wastage_value_by_date, gap_value_by_date
        ),
        "used_vs_expected": _used_vs_expected(per_item),
        "wastage_trend": _wastage_trend(
            business,
            buckets,
            wastage_value_by_date,
            wastage_qty_by_date_unit,
            window_start_date,
            tz,
        ),
        "price_trend": _price_trend(business, window_start_dt, window_end_dt, item_id),
        "sales_vs_cost": _sales_vs_cost(business, buckets, window_start_date, window_end_date),
        "biggest_gaps": _biggest_gaps(per_item),
    }
