from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework.response import Response

from core.exceptions import BusinessRuleError
from core.roles import Capability
from core.viewsets import TenantAPIView
from reports import services
from reports.notifiers import whatsapp_share_link

MAX_RANGE_DAYS = 400


def _range(request):
    """Date range from the query string, defaulting to the current week (§6)."""
    today = timezone.localdate()
    default_start, default_end = services.week_bounds(today)

    start = parse_date(request.query_params.get("start", "")) or default_start
    end = parse_date(request.query_params.get("end", "")) or default_end
    if end < start:
        raise BusinessRuleError("End date is before the start date.", code="bad_range")
    if (end - start).days > MAX_RANGE_DAYS:
        raise BusinessRuleError(
            f"Pick a range of {MAX_RANGE_DAYS} days or fewer.", code="range_too_long"
        )
    return start, end


class ReportView(TenantAPIView):
    read_capability = Capability.REPORTS_VIEW

    def get(self, request, *args, **kwargs):
        start, end = _range(request)
        business = self.access.business
        report = services.cost_report(business, start, end)
        report["alerts"] = services.threshold_alerts(business, start, end, report=report)
        report["alerts"] += services.operational_alerts(business, start, end)
        report["share_text"] = _share_text(business, report)
        report["share_link"] = whatsapp_share_link("", report["share_text"])
        return Response(report)


class VarianceView(TenantAPIView):
    read_capability = Capability.REPORTS_VIEW

    def get(self, request, *args, **kwargs):
        start, end = _range(request)
        return Response(services.variance_report(self.access.business, start, end))


class TrendsView(TenantAPIView):
    read_capability = Capability.REPORTS_VIEW

    def get(self, request, *args, **kwargs):
        try:
            weeks = max(1, min(int(request.query_params.get("weeks", 8)), 26))
        except ValueError as exc:
            raise BusinessRuleError("weeks must be a number.", code="bad_weeks") from exc
        return Response(services.trends(self.access.business, weeks=weeks))


class AlertsView(TenantAPIView):
    """The banner payload. Available to every role, but variance alerts are stripped for the roles
    that must not see expected usage (non-negotiable #4).

    Takes an optional `start`/`end` so the Report screen's banner covers the range being looked at;
    without them it covers the current week, which is what the entry screens want.
    """

    def get(self, request, *args, **kwargs):
        business = self.access.business
        now = timezone.localtime()
        start, end = _range(request)

        if self.access.can(Capability.SEE_VARIANCE):
            found = services.alerts(business, now=now, start=start, end=end)
        else:
            found = services.sla_alerts(business, now)
            found += services.operational_alerts(business, start, end)
            found.sort(key=lambda alert: services.SEVERITY_ORDER.get(alert["severity"], 9))
        return Response(found)


def _share_text(business, report) -> str:
    totals = report["totals"]
    lines = [
        f"{business.name} — {report['start']:%d %b} to {report['end']:%d %b}",
        f"Revenue ₹{totals['revenue']}  |  Cost ₹{totals['cost']}"
        + (
            f"  |  {totals['cost_pct']}% (target {totals['target_pct']}%)"
            if totals["cost_pct"] is not None
            else ""
        ),
    ]
    over = [
        row
        for row in report["ingredients"]
        if row["cost_pct"] is not None and row["cost_pct"] > row["target_pct"]
    ][:5]
    if over:
        lines.append("Over target: " + ", ".join(f"{r['name']} {r['cost_pct']}%" for r in over))
    if report["segregation_flags"]:
        lines.append(f"{len(report['segregation_flags'])} segregation-of-duties flag(s)")
    lines.append("— via EasyKharcha")
    return "\n".join(lines)
