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
from counts.gap import lines_with_gap, unit_cost_for
from counts.models import CountType, StockCount
from purchases.models import PurchaseLine
from wastage.models import WastageEntry

from .models import AlertCheck

ZERO = Decimal("0")
WASTAGE_WINDOW_DAYS = 7
PRICE_RISE_WINDOW_DAYS = 30
MIN_PRIOR_PURCHASES = 2

ALERT_TYPES = ("count_late", "price_rise", "wastage_high", "gap_flagged")

# Danger alerts (price_rise, gap_flagged) sort ahead of warnings (count_late, wastage_high); within
# a tier, the alert with the bigger rupee value behind it sorts first.
SEVERITY_RANK = {"danger": 0, "warning": 1}


def _business_today(business: Business):
    tz = ZoneInfo(business.timezone)
    return timezone.localtime(timezone.now(), tz).date()


def _count_late_alerts(business: Business, role: str | None) -> list[dict]:
    today = _business_today(business)
    now = timezone.now()
    tz = ZoneInfo(business.timezone)
    submitted_types = set(
        StockCount.objects.filter(business=business, business_date=today).values_list(
            "count_type", flat=True
        )
    )
    is_owner = role == AccessRole.OWNER

    alerts = []
    for count_type, hour_field, label in (
        (CountType.OPENING, "count_deadline_hour", "Opening"),
        (CountType.CLOSING, "closing_count_hour", "Closing"),
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
                "key": f"count_late:{count_type}:{today.isoformat()}",
                "type": "count_late",
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
        avg_display = avg_price.quantize(Decimal("0.01"))
        pct_display = pct_increase.quantize(Decimal("0.01"))
        alerts.append(
            {
                "key": f"price_rise:{item.id}:{purchase_date.isoformat()}",
                "type": "price_rise",
                "title": f"{item.name} price is up",
                "detail": (
                    f"Latest purchase ₹{item.last_unit_price} vs average ₹{avg_display} "
                    f"({pct_display}% higher)."
                ),
                "severity": "danger",
                "numbers": {
                    "latest_price": str(item.last_unit_price),
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
        alerts.append(
            {
                "key": f"wastage_high:{item.id}:{today.isoformat()}",
                "type": "wastage_high",
                "title": f"{item.name} wastage is high",
                "detail": (
                    f"{wasted} {item.unit} wasted out of {bought} {item.unit} bought in the "
                    f"last 7 days ({pct_display}%)."
                ),
                "severity": "warning",
                "numbers": {
                    "wasted_qty": str(wasted),
                    "bought_qty": str(bought),
                    "pct": str(pct_display),
                    "unit": item.unit,
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
        alerts.append(
            {
                "key": f"gap_flagged:{line['stock_item']}:{date_label}",
                "type": "gap_flagged",
                "title": f"{line['stock_item_name']} has an unexplained gap",
                "detail": (
                    f"Gap of {gap_qty} {line['unit']}{value_part} in the {date_label} "
                    "closing count."
                ),
                "severity": "danger",
                "numbers": {
                    "gap_qty": str(gap_qty) if gap_qty is not None else None,
                    "gap_value": str(gap_value) if gap_value is not None else None,
                    "expected_used": (
                        str(line["expected_used"]) if line["expected_used"] is not None else None
                    ),
                    "unit": line["unit"],
                },
                "next_action": {"label": "Review count", "route": f"/counts/{latest_closing.id}"},
                "value": abs(gap_value) if gap_value is not None else ZERO,
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
