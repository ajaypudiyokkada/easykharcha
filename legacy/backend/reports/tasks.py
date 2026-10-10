"""Scheduled alert evaluation.

The same `services.alerts()` the dashboard calls on demand, run on a schedule so an owner hears about a
missing closing count without having to open the app (§4).
"""

import logging

from celery import shared_task
from django.utils import timezone

from accounts.models import Access
from audit.services import log
from core.roles import OWNER, SUPER_ADMIN
from reports import services
from reports.notifiers import get_notifier
from tenants.models import Business, BusinessStatus

logger = logging.getLogger(__name__)


@shared_task(name="reports.sweep_all_tenants")
def sweep_all_tenants() -> dict:
    results = {}
    for business in Business.objects.filter(status=BusinessStatus.ACTIVE):
        try:
            results[business.id] = sweep_tenant(business.id)
        except Exception:  # pragma: no cover - one tenant's failure must not stop the sweep
            logger.exception("SLA sweep failed for business %s", business.id)
            results[business.id] = {"error": True}
    return results


@shared_task(name="reports.sweep_tenant")
def sweep_tenant(business_id: int) -> dict:
    business = Business.objects.get(pk=business_id)
    now = timezone.localtime()
    found = services.alerts(business, now=now)
    high = [alert for alert in found if alert["severity"] == "high"]
    if not high:
        return {"alerts": len(found), "notified": 0}

    recipients = _alert_recipients(business)
    notifier = get_notifier()
    body = "\n".join(f"• {alert['message']}" for alert in high)
    sent = 0
    for phone in recipients:
        if notifier.send(
            to=phone,
            subject=f"{business.name}: {len(high)} alert(s)",
            body=body,
            meta={"business_id": business.id},
        ):
            sent += 1

    log(
        None,
        "alerts.sweep",
        summary=f"{len(high)} high-severity alert(s), notified {sent} recipient(s)",
        detail={"alerts": high},
        business=business,
    )
    return {"alerts": len(found), "high": len(high), "notified": sent}


def _alert_recipients(business) -> list[str]:
    """Owners of this tenant plus global Super Admins."""
    from django.db.models import Q

    return list(
        Access.objects.filter(
            Q(business=business, role=OWNER) | Q(business__isnull=True, role=SUPER_ADMIN),
            active=True,
            user__active=True,
        )
        .values_list("user__phone", flat=True)
        .distinct()
    )
