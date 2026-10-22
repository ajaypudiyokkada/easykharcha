"""Step 23b: one opening count, then one closing count, per business date, clearly guided — the
order rule and the "today status" shape the Count screen and Home's Today card both read, so
there's one place that decides locked/due/late/done and next_action, not two drifting copies."""

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

from businesses.models import Business

from .business_day import business_date_for, has_any_count
from .config import CLOSING_GRACE_HOURS
from .models import CountType, StockCount


def deadline_at_for(business: Business, business_date, count_type: str):
    tz = ZoneInfo(business.timezone)
    hour = (
        business.settings.count_deadline_hour
        if count_type == CountType.OPENING
        else business.settings.closing_count_hour
    )
    return datetime.combine(business_date, time(hour=hour), tzinfo=tz)


def opening_missed(business: Business, business_date, now: datetime) -> bool:
    """True once it's too late to expect an opening count first: its own deadline has passed, or
    the closing window has already begun. This is what unlocks a closing count with no opening.
    Step 23d: a business that has never counted anything can't have "missed" its first opening —
    there is no deadline for it, so a closing can never jump ahead of it."""
    if not has_any_count(business):
        return False
    opening_deadline = deadline_at_for(business, business_date, CountType.OPENING)
    closing_deadline = deadline_at_for(business, business_date, CountType.CLOSING)
    return now > opening_deadline or now > closing_deadline


def status_for(business: Business, now: datetime | None = None) -> dict:
    now = now or timezone.now()
    business_date = business_date_for(business, now)
    is_first_count = not has_any_count(business)

    counts_today = {
        c.count_type: c
        for c in StockCount.objects.filter(
            business=business, business_date=business_date
        ).select_related("counted_by")
    }
    opening_count = counts_today.get(CountType.OPENING)
    closing_count = counts_today.get(CountType.CLOSING)
    opening_done = opening_count is not None
    closing_done = closing_count is not None

    opening_deadline = deadline_at_for(business, business_date, CountType.OPENING)
    closing_deadline = deadline_at_for(business, business_date, CountType.CLOSING)
    closing_late_at = closing_deadline + timedelta(hours=CLOSING_GRACE_HOURS)

    missed = opening_missed(business, business_date, now)
    closing_locked = not opening_done and not missed

    if opening_done:
        opening_state = "done"
    elif is_first_count:
        # Step 23d: a brand-new business's first count is allowed at any time of day, never late.
        opening_state = "due"
    elif now > opening_deadline:
        opening_state = "late"
    else:
        opening_state = "due"

    if closing_done:
        closing_state = "done"
    elif closing_locked:
        closing_state = "locked"
    elif now > closing_late_at:
        closing_state = "late"
    else:
        closing_state = "due"

    if not opening_done and closing_locked:
        next_action = "opening"
    elif not closing_done:
        next_action = "closing"
    else:
        next_action = "none"

    def done_fields(count: StockCount | None) -> dict:
        if count is None:
            return {"done_at": None, "by": None}
        return {"done_at": count.submitted_at, "by": count.counted_by.name}

    return {
        "business_date": business_date,
        "is_first_count": is_first_count,
        "opening": {
            "state": opening_state,
            "due_by": opening_deadline,
            **done_fields(opening_count),
        },
        "closing": {
            "state": closing_state,
            "due_from": closing_deadline,
            "missing_opening": not opening_done and not closing_locked,
            **done_fields(closing_count),
        },
        "next_action": next_action,
    }
