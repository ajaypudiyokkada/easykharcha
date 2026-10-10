"""Role-specific home dashboards (§1b).

Non-negotiable #4 is enforced here by construction rather than by filtering: the Staff/Head Chef payload
is assembled from a different set of queries that never touch Sale, expected usage or variance. There is
no sensitive key to accidentally leave in.
"""

from datetime import timedelta

from django.utils import timezone

from core.roles import HEAD_CHEF, MANAGER, STAFF, Capability
from inventory.models import (
    DailyStock,
    Dish,
    Ingredient,
    Purchase,
    Request,
    RequestStatus,
    Sale,
    SalesImport,
)
from reports import services


def home(access) -> dict:
    business = access.business
    now = timezone.localtime()
    today = now.date()

    payload = {
        "role": access.role,
        "capabilities": access.capabilities,
        "date": today,
        "business": {
            "id": business.id,
            "name": business.name,
            "tagline": business.tagline,
            "dish_label": business.dish_label,
            "primary_colour": business.primary_colour,
            "accent_colour": business.accent_colour,
            "logo": business.logo.url if business.logo else None,
        },
    }

    if access.role in (STAFF, HEAD_CHEF):
        payload.update(_capture_dashboard(business, access, now))
    elif access.role == MANAGER:
        payload.update(_manager_dashboard(business, today))
    else:
        payload.update(_owner_dashboard(business, now))
    return payload


def _capture_dashboard(business, access, now) -> dict:
    """Today's tasks and SLA status. Deliberately blind — no sales, no expected usage, no variance."""
    today = now.date()
    yesterday = today - timedelta(days=1)
    tracked = list(Ingredient.objects.filter(business=business, track=True).order_by("name"))
    tracked_ids = [i.id for i in tracked]

    opened = set(
        DailyStock.objects.filter(
            business=business, date=today, ingredient_id__in=tracked_ids, opening_qty__isnull=False
        ).values_list("ingredient_id", flat=True)
    )
    closed_yesterday = set(
        DailyStock.objects.filter(
            business=business,
            date=yesterday,
            ingredient_id__in=tracked_ids,
            closing_qty__isnull=False,
        ).values_list("ingredient_id", flat=True)
    )
    closed_today = set(
        DailyStock.objects.filter(
            business=business, date=today, ingredient_id__in=tracked_ids, closing_qty__isnull=False
        ).values_list("ingredient_id", flat=True)
    )

    tasks = [
        {
            "key": "opening",
            "label": "Record opening stock",
            "done": len(opened),
            "total": len(tracked),
            "pending": [i.name for i in tracked if i.id not in opened][:20],
        },
        {
            "key": "closing_yesterday",
            "label": f"Record closing stock for {yesterday:%d %b}",
            "done": len(closed_yesterday),
            "total": len(tracked),
            "pending": [i.name for i in tracked if i.id not in closed_yesterday][:20],
        },
        {
            "key": "closing_today",
            "label": "Record closing stock for today",
            "done": len(closed_today),
            "total": len(tracked),
            "pending": [i.name for i in tracked if i.id not in closed_today][:20],
        },
    ]

    cards = {
        "tasks": tasks,
        "alerts": services.sla_alerts(business, now),
        "my_requests": [],
    }
    if access.can(Capability.REQUEST_RAISE):
        cards["my_requests"] = [
            {
                "id": request.id,
                "date": request.date,
                "ingredient": request.ingredient.name,
                "qty": request.qty,
                "status": request.status,
            }
            for request in Request.objects.filter(
                business=business, requested_by=access.user, status=RequestStatus.OPEN
            ).select_related("ingredient")[:10]
        ]
    return cards


def _manager_dashboard(business, today) -> dict:
    """Sales capture status, open requests, short deliveries. No variance (Owner-only, §1)."""
    dish_count = Dish.objects.filter(business=business, active=True).count()
    sales_today = Sale.objects.filter(business=business, date=today).count()
    last_import = SalesImport.objects.filter(business=business).first()

    open_requests = (
        Request.objects.filter(business=business, status=RequestStatus.OPEN)
        .select_related("ingredient", "requested_by")
        .order_by("date")[:20]
    )
    week_start, week_end = services.week_bounds(today)
    shorts = [
        alert
        for alert in services.operational_alerts(business, week_start, week_end)
        if alert["code"] == "short_delivery"
    ]

    return {
        "sales_status": {
            "dishes_active": dish_count,
            "dishes_recorded_today": sales_today,
            "complete": dish_count > 0 and sales_today >= dish_count,
            "last_import": (
                {
                    "filename": last_import.filename,
                    "uploaded_at": last_import.uploaded_at,
                    "date_from": last_import.date_from,
                    "date_to": last_import.date_to,
                    "rows_matched": last_import.rows_matched,
                    "rows_unmatched": last_import.rows_unmatched,
                }
                if last_import
                else None
            ),
        },
        "open_requests": [
            {
                "id": request.id,
                "date": request.date,
                "ingredient": request.ingredient.name,
                "qty": request.qty,
                "note": request.note,
                "requested_by": (
                    request.requested_by.name or request.requested_by.phone
                    if request.requested_by
                    else None
                ),
            }
            for request in open_requests
        ],
        "short_deliveries": shorts,
        "alerts": services.sla_alerts(business, timezone.localtime()),
    }


def _owner_dashboard(business, now) -> dict:
    """Alerts, week-to-date cost%, top variances, kitchen efficiency."""
    today = now.date()
    week_start, week_end = services.week_bounds(today)

    report = services.cost_report(business, week_start, today)
    variance = services.variance_report(business, week_start, today)

    all_alerts = services.sla_alerts(business, now)
    all_alerts += services.operational_alerts(business, week_start, today)
    all_alerts += services.threshold_alerts(business, week_start, today, report=report)
    all_alerts.sort(key=lambda alert: services.SEVERITY_ORDER.get(alert["severity"], 9))

    top_variances = [
        row
        for row in variance["rows"]
        if row["unexplained_value"] is not None and row["status"] in ("ok", "alert")
    ][:5]

    return {
        "week": {"start": week_start, "end": week_end, "through": today},
        "week_to_date": {
            "revenue": report["totals"]["revenue"],
            "cost": report["totals"]["cost"],
            "cost_pct": report["totals"]["cost_pct"],
            "target_pct": report["totals"]["target_pct"],
            "plates": report["totals"]["plates"],
            "over_target": (
                report["totals"]["cost_pct"] is not None
                and report["totals"]["cost_pct"] > report["totals"]["target_pct"]
            ),
            # So the dashboard can say "based on 4 of 7 ingredients" rather than implying the figure
            # is complete when half the counts are missing.
            "ingredients_costed": report["totals"]["ingredients_costed"],
            "ingredients_total": report["totals"]["ingredients_total"],
            "ingredients_missing_counts": report["totals"]["ingredients_missing_counts"],
            "complete": report["totals"]["complete"],
        },
        "kitchen_efficiency_pct": variance["kitchen_efficiency_pct"],
        "unexplained_loss_value": variance["totals"]["unexplained_loss_value"],
        "top_variances": top_variances,
        "alerts": all_alerts,
        "counts": {
            "open_requests": Request.objects.filter(
                business=business, status=RequestStatus.OPEN
            ).count(),
            "purchases_this_week": Purchase.objects.filter(
                business=business, date__gte=week_start, date__lte=today
            ).count(),
        },
        "segregation_flags": report["segregation_flags"],
    }
