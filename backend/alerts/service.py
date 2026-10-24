"""Step 15: alerts computed on demand when read — no Celery, no scheduled jobs, nothing stored but
which ones have been checked (see AlertCheck). Each alert carries a stable key (type + item id +
date) so a check hides it only until its key changes — a new day, a new purchase, a new count —
never forever.

One query (or a small, fixed number of grouped queries) per alert type, never a per-item loop —
`compute_alerts` is called on every GET of the Alerts screen and every Today summary.
"""

from datetime import datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db.models import Avg, Count, F, OuterRef, Subquery, Sum
from django.utils import timezone

from businesses.models import AccessRole, Business
from counts.business_day import business_date_for, has_any_count
from counts.gap import lines_with_gap, unit_cost_for
from counts.models import CountLine, CountLineState, CountType, StockCount
from purchases.models import PurchaseLine
from stock.units import display_price_per_major_unit, display_quantities, display_quantity
from wastage.models import WastageEntry

from .models import AlertCheck

ZERO = Decimal("0")
MONEY_PLACES = Decimal("0.01")
WASTAGE_WINDOW_DAYS = 7
PRICE_RISE_WINDOW_DAYS = 30
MIN_PRIOR_PURCHASES = 2
# Step 18: a count more than this many days old is still used for an expiry estimate (the
# alternative — no estimate at all — is worse), just flagged as needing a recount to confirm.
EXPIRY_STALE_COUNT_DAYS = 3

ALERT_TYPES = (
    "opening_late",
    "closing_late",
    "price_rise",
    "wastage_high",
    "gap_flagged",
    "expiry_soon",
)

# Danger alerts (price_rise, gap_flagged) sort ahead of warnings (count_late, wastage_high); within
# a tier, the alert with the bigger rupee value behind it sorts first.
SEVERITY_RANK = {"danger": 0, "warning": 1}


def _business_today(business: Business):
    tz = ZoneInfo(business.timezone)
    return timezone.localtime(timezone.now(), tz).date()


def _count_late_alerts(business: Business, role: str | None) -> list[dict]:
    # Step 23d: a business that has never counted anything can't be "late" for its first count —
    # no opening_late/closing_late alert exists until at least one count has ever been submitted.
    if not has_any_count(business):
        return []

    # Step 23b: this one alert uses the business-day-aware date (day_starts_hour), not the plain
    # calendar date the other alert types below still use — it's tied to the same one-opening/
    # one-closing-per-business-date rule counts/views.py enforces.
    today = business_date_for(business)
    now = timezone.now()
    tz = ZoneInfo(business.timezone)
    submitted_types = set(
        StockCount.objects.filter(business=business, business_date=today).values_list(
            "count_type", flat=True
        )
    )
    is_owner = role == AccessRole.OWNER

    alerts = []
    for count_type, hour_field, label, alert_type, key in (
        (
            CountType.OPENING,
            "count_deadline_hour",
            "Opening",
            "opening_late",
            # Kept exactly as it was before the opening/closing split, so an already-checked
            # opening_late alert for today stays checked.
            f"count_late:{CountType.OPENING}:{today.isoformat()}",
        ),
        (
            CountType.CLOSING,
            "closing_count_hour",
            "Closing",
            "closing_late",
            f"closing_late:{today.isoformat()}",
        ),
    ):
        if count_type in submitted_types:
            continue
        hour = getattr(business.settings, hour_field)
        deadline_at = datetime.combine(today, time(hour=hour), tzinfo=tz)
        if now <= deadline_at:
            continue
        minutes_late = int((now - deadline_at).total_seconds() // 60)
        alerts.append(
            {
                "key": key,
                "type": alert_type,
                "title": f"{label} count is late",
                "detail": (f"Late by {minutes_late} min. Due by {deadline_at.strftime('%H:%M')}."),
                "severity": "warning",
                "numbers": {
                    "count_type": count_type,
                    "minutes_late": minutes_late,
                    "deadline_hour": hour,
                },
                "next_action": (
                    {"label": "Prepare reminder", "route": "/counts"}
                    if is_owner
                    else {"label": "Open count review", "route": "/counts"}
                ),
                "value": ZERO,
            }
        )
    return alerts


def _with_last_purchase_info(queryset):
    """Same annotation stock/views.py uses — one correlated-subquery query, no per-item loop."""
    latest_line = PurchaseLine.objects.filter(
        stock_item=OuterRef("pk"), purchase__is_deleted=False
    ).order_by("-purchase__purchase_date_time", "-id")
    return queryset.annotate(
        last_unit_price=Subquery(latest_line.values("unit_price")[:1]),
        last_purchased_at=Subquery(latest_line.values("purchase__purchase_date_time")[:1]),
    )


def _prior_purchase_stats(business: Business, window_start) -> dict[int, dict]:
    """Average price and count of each stock item's purchase lines in the last 30 days, excluding
    the latest line itself — one grouped query (a correlated subquery per row, not a Python loop)."""
    latest_dt_subquery = (
        PurchaseLine.objects.filter(stock_item=OuterRef("stock_item"), purchase__is_deleted=False)
        .order_by("-purchase__purchase_date_time", "-id")
        .values("purchase__purchase_date_time")[:1]
    )
    rows = (
        PurchaseLine.objects.filter(
            stock_item__business=business,
            stock_item__active=True,
            purchase__is_deleted=False,
            purchase__purchase_date_time__gte=window_start,
        )
        .annotate(_latest_dt=Subquery(latest_dt_subquery))
        .exclude(purchase__purchase_date_time=F("_latest_dt"))
        .values("stock_item")
        .annotate(avg_price=Avg("unit_price"), prior_count=Count("id"))
    )
    return {
        row["stock_item"]: {
            # SQLite computes Avg as a float; convert back via str so no float ever touches a
            # money comparison below.
            "avg_price": Decimal(str(row["avg_price"])) if row["avg_price"] is not None else None,
            "prior_count": row["prior_count"],
        }
        for row in rows
    }


def _price_rise_alerts(business: Business) -> list[dict]:
    rate_creep_pct = business.settings.rate_creep_pct
    now = timezone.now()
    window_start = now - timedelta(days=PRICE_RISE_WINDOW_DAYS)
    tz = ZoneInfo(business.timezone)

    items = list(_with_last_purchase_info(business.stock_items.filter(active=True)))
    prior_stats = _prior_purchase_stats(business, window_start)

    alerts = []
    for item in items:
        if item.last_unit_price is None or item.last_purchased_at is None:
            continue
        stats = prior_stats.get(item.id)
        if stats is None or stats["prior_count"] < MIN_PRIOR_PURCHASES:
            continue
        avg_price = stats["avg_price"]
        if not avg_price or avg_price <= ZERO:
            continue
        pct_increase = ((item.last_unit_price - avg_price) / avg_price) * Decimal("100")
        if pct_increase <= rate_creep_pct:
            continue
        purchase_date = timezone.localtime(item.last_purchased_at, tz).date()
        pct_display = pct_increase.quantize(Decimal("0.01"))
        latest_display = display_price_per_major_unit(item.last_unit_price, item.unit)
        avg_display = display_price_per_major_unit(avg_price, item.unit)
        alerts.append(
            {
                "key": f"price_rise:{item.id}:{purchase_date.isoformat()}",
                "type": "price_rise",
                "title": f"{item.name} price is up",
                "detail": (
                    f"Latest purchase ₹{latest_display} vs average ₹{avg_display} "
                    f"({pct_display}% higher)."
                ),
                "severity": "danger",
                "numbers": {
                    "latest_price": str(latest_display),
                    "average_price": str(avg_display),
                    "pct_increase": str(pct_display),
                },
                "next_action": {"label": f"Open {item.name}", "route": f"/stock/{item.id}"},
                "value": abs(item.last_unit_price - avg_price),
            }
        )
    return alerts


def _wastage_high_alerts(business: Business) -> list[dict]:
    wastage_alert_pct = business.settings.wastage_alert_pct
    now = timezone.now()
    window_start = now - timedelta(days=WASTAGE_WINDOW_DAYS)
    today = _business_today(business)

    wasted_by_item = {
        row["stock_item"]: row["total"]
        for row in WastageEntry.objects.filter(
            business=business,
            is_deleted=False,
            recorded_at__gte=window_start,
            recorded_at__lte=now,
        )
        .values("stock_item")
        .annotate(total=Sum("quantity"))
    }
    bought_by_item = {
        row["stock_item"]: row["total"]
        for row in PurchaseLine.objects.filter(
            stock_item__business=business,
            purchase__is_deleted=False,
            purchase__purchase_date_time__gte=window_start,
            purchase__purchase_date_time__lte=now,
        )
        .values("stock_item")
        .annotate(total=Sum("quantity"))
    }

    alerts = []
    for item in business.stock_items.filter(active=True):
        wasted = wasted_by_item.get(item.id)
        bought = bought_by_item.get(item.id)
        if not wasted or not bought:
            continue
        pct = (wasted / bought) * Decimal("100")
        if pct <= wastage_alert_pct:
            continue
        unit_cost = unit_cost_for(item)
        value = wasted * unit_cost if unit_cost is not None else ZERO
        pct_display = pct.quantize(Decimal("0.01"))
        display, display_unit = display_quantities({"wasted": wasted, "bought": bought}, item.unit)
        alerts.append(
            {
                "key": f"wastage_high:{item.id}:{today.isoformat()}",
                "type": "wastage_high",
                "title": f"{item.name} wastage is high",
                "detail": (
                    f"{display['wasted']} {display_unit} wasted out of {display['bought']} "
                    f"{display_unit} bought in the last 7 days ({pct_display}%)."
                ),
                "severity": "warning",
                "numbers": {
                    "wasted_qty": str(display["wasted"]),
                    "bought_qty": str(display["bought"]),
                    "pct": str(pct_display),
                    "unit": display_unit,
                },
                "next_action": {"label": "Open wastage", "route": "/wastage"},
                "value": value,
            }
        )
    return alerts


def _gap_flagged_alerts(business: Business) -> list[dict]:
    latest_closing = (
        StockCount.objects.filter(business=business, count_type=CountType.CLOSING)
        .order_by("-business_date", "-submitted_at")
        .first()
    )
    if latest_closing is None:
        return []

    date_label = latest_closing.business_date.isoformat()
    alerts = []
    for line in lines_with_gap(business, latest_closing):
        if not line["flagged"]:
            continue
        gap_qty = line["gap_qty"]
        gap_value = line["gap_value"]
        value_part = f" (₹{gap_value})" if gap_value is not None else ""
        display, display_unit = display_quantities(
            {"gap_qty": gap_qty, "expected_used": line["expected_used"]}, line["unit"]
        )
        alerts.append(
            {
                "key": f"gap_flagged:{line['stock_item']}:{date_label}",
                "type": "gap_flagged",
                "title": f"{line['stock_item_name']} has an unexplained gap",
                "detail": (
                    f"Gap of {display['gap_qty']} {display_unit}{value_part} in the {date_label} "
                    "closing count."
                ),
                "severity": "danger",
                "numbers": {
                    "gap_qty": str(display["gap_qty"]) if gap_qty is not None else None,
                    "gap_value": str(gap_value) if gap_value is not None else None,
                    "expected_used": (
                        str(display["expected_used"]) if line["expected_used"] is not None else None
                    ),
                    "unit": display_unit,
                },
                "next_action": {"label": "Review count", "route": f"/counts/{latest_closing.id}"},
                "value": abs(gap_value) if gap_value is not None else ZERO,
            }
        )
    return alerts


def _at_risk_batch(stock_item, counted_qty: Decimal, as_of) -> tuple[PurchaseLine, Decimal] | None:
    """Which purchase this item's current count is most likely still holding, under a FIFO-usage
    assumption: if older stock always gets used before newer stock, whatever's left on hand must be
    made up of the most recent purchases — so walking purchase lines newest-first and accumulating
    quantity until it covers the count reconstructs the batches still around. The oldest one needed
    to cover the count (it may be only partly needed) has been sitting the longest, so it's the one
    closest to its shelf life. None if this item has no purchase history at all to anchor a guess to."""
    lines = list(
        PurchaseLine.objects.filter(
            stock_item=stock_item,
            purchase__is_deleted=False,
            purchase__purchase_date_time__lte=as_of,
        )
        .select_related("purchase")
        .order_by("-purchase__purchase_date_time", "-id")
    )
    if not lines:
        return None

    running_total = ZERO
    for line in lines:
        portion = min(line.quantity, counted_qty - running_total)
        running_total += portion
        if running_total >= counted_qty:
            return line, portion

    # Every known purchase together still doesn't add up to what's on hand (older stock than this
    # app has purchase history for) — the oldest one known is the best available anchor.
    oldest = lines[-1]
    return oldest, oldest.quantity


def _expiry_soon_alerts(business: Business) -> list[dict]:
    warn_days = business.settings.expiry_warn_days
    today = _business_today(business)
    tz = ZoneInfo(business.timezone)

    items = business.stock_items.filter(active=True, goes_off=True, shelf_life_days__isnull=False)

    alerts = []
    for item in items:
        latest_line = (
            CountLine.objects.filter(
                stock_item=item, count__business=business, state=CountLineState.COUNTED
            )
            .select_related("count")
            .order_by("-count__submitted_at")
            .first()
        )
        if latest_line is None or not latest_line.counted_qty:
            continue

        count = latest_line.count
        batch = _at_risk_batch(item, latest_line.counted_qty, count.submitted_at)
        if batch is None:
            continue
        at_risk_line, at_risk_qty = batch

        purchase_date = timezone.localtime(at_risk_line.purchase.purchase_date_time, tz).date()
        expiry_date = purchase_date + timedelta(days=item.shelf_life_days)
        days_left = (expiry_date - today).days
        if days_left > warn_days:
            continue

        severity = "danger" if days_left <= 0 else "warning"
        expiry_label = f"{expiry_date.day} {expiry_date.strftime('%b')}"
        purchase_label = f"{purchase_date.day} {purchase_date.strftime('%b')}"
        day_word = "day" if abs(days_left) == 1 else "days"

        if severity == "danger":
            title = f"{item.name} may already be past its shelf life"
            shelf_phrase = (
                f"about {abs(days_left)} {day_word} past its {item.shelf_life_days}-day shelf life"
            )
        else:
            title = f"{item.name} may go off by {expiry_label}"
            shelf_phrase = (
                f"{days_left} {day_word} left of its {item.shelf_life_days}-day shelf life"
            )
        display_qty, display_unit = display_quantity(at_risk_qty, item.unit)
        detail = (
            f"{display_qty} {display_unit} from the {purchase_label} purchase — {shelf_phrase}."
        )

        is_stale = (timezone.now() - count.submitted_at) > timedelta(days=EXPIRY_STALE_COUNT_DAYS)
        if is_stale:
            count_date = count.business_date.isoformat()
            detail += f" Based on a count from {count_date}; recount to confirm."

        value = (at_risk_qty * at_risk_line.unit_price).quantize(MONEY_PLACES)
        alerts.append(
            {
                "key": f"expiry_soon:{item.id}:{at_risk_line.purchase_id}",
                "type": "expiry_soon",
                "title": title,
                "detail": detail,
                "severity": severity,
                "numbers": {
                    "item_name": item.name,
                    "at_risk_qty": str(display_qty),
                    "unit": display_unit,
                    "expiry_date": expiry_date.isoformat(),
                    "days_left": days_left,
                    "value_at_risk": str(value),
                    "count_is_stale": is_stale,
                },
                "next_action": {"label": "Use these first", "route": f"/stock/{item.id}"},
                "value": value,
            }
        )
    return alerts


def compute_alerts(business: Business, role: str | None = None) -> list[dict]:
    """Every currently-true alert for `business`, sorted by severity then rupee value — regardless
    of whether it's already been checked (see `open_alerts` for that)."""
    alerts = [
        *_count_late_alerts(business, role),
        *_price_rise_alerts(business),
        *_wastage_high_alerts(business),
        *_gap_flagged_alerts(business),
        *_expiry_soon_alerts(business),
    ]
    alerts.sort(key=lambda alert: (SEVERITY_RANK.get(alert["severity"], 1), -alert["value"]))
    for alert in alerts:
        del alert["value"]
    return alerts


def open_alerts(business: Business, role: str | None = None) -> list[dict]:
    """compute_alerts(), minus whatever's already been checked and whose key hasn't changed since."""
    alerts = compute_alerts(business, role)
    checked_keys = set(
        AlertCheck.objects.filter(business=business).values_list("alert_key", flat=True)
    )
    return [alert for alert in alerts if alert["key"] not in checked_keys]
