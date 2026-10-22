from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

from businesses.models import Business


def business_date_for(business: Business, at: datetime | None = None):
    """The business-local calendar date `at` (default: now) falls on, per the business's
    day_starts_hour — a closing count done at 01:00 with day_starts_hour=5 belongs to the
    previous business date, not the calendar date it was typed on."""
    tz = ZoneInfo(business.timezone)
    moment = at or timezone.now()
    shifted = timezone.localtime(moment, tz) - timedelta(hours=business.settings.day_starts_hour)
    return shifted.date()


def has_any_count(business: Business) -> bool:
    """True once the business has ever submitted a stock count — opening or closing, any date.
    Step 23d: gates the "Starting stock" first-count framing and suppresses opening_late/
    closing_late alerts until a brand-new business has counted something at least once."""
    from .models import StockCount

    return StockCount.objects.filter(business=business).exists()
