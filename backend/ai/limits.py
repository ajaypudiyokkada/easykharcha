"""Per-business daily caps and the whole-deployment monthly cost cap. The daily caps reuse
accounts/ratelimit.py's cache-backed counter pattern, keyed with today's date so they reset at
midnight for free — a new date is a new cache key — rather than needing a scheduled reset job."""

from decimal import Decimal

from django.conf import settings
from django.core.cache import cache
from django.db.models import Sum
from django.utils import timezone

from .models import AiUsage, AiUsageKind

DAILY_PAGES_PER_BUSINESS = 20
DAILY_RECIPE_DISHES_PER_BUSINESS = 60
MAX_DISHES_PER_RECIPE_CALL = 15
DAILY_KITCHEN_DISHES_PER_BUSINESS = 400
# Step EK-3: a family-recipe AI call per family (recipe_composer.MAX_FAMILIES_PER_MENU caps a single
# menu at 25 already) — this is the per-business daily ceiling across however many menus/retries.
DAILY_SETUP_FAMILIES_PER_BUSINESS = 100

_WINDOW_SECONDS = 86400


def _hit_n(key: str, amount: int, limit: int) -> bool:
    cache_key = f"ratelimit:{key}"
    current = cache.get(cache_key) or 0
    if current + amount > limit:
        return False
    if current == 0:
        cache.set(cache_key, amount, timeout=_WINDOW_SECONDS)
    else:
        cache.incr(cache_key, amount)
    return True


def check_daily_scan_limit(business_id: int) -> bool:
    today = timezone.localdate().isoformat()
    return _hit_n(f"ai_scans:{business_id}:{today}", 1, settings.AI_DAILY_SCANS_PER_BUSINESS)


def check_daily_pages_limit(business_id: int, page_count: int) -> bool:
    today = timezone.localdate().isoformat()
    return _hit_n(f"ai_pages:{business_id}:{today}", page_count, DAILY_PAGES_PER_BUSINESS)


def check_daily_recipe_limit(business_id: int, dish_count: int) -> bool:
    today = timezone.localdate().isoformat()
    return _hit_n(
        f"ai_recipe_dishes:{business_id}:{today}", dish_count, DAILY_RECIPE_DISHES_PER_BUSINESS
    )


def check_daily_kitchen_limit(business_id: int, dish_count: int) -> bool:
    today = timezone.localdate().isoformat()
    return _hit_n(
        f"ai_kitchen_dishes:{business_id}:{today}", dish_count, DAILY_KITCHEN_DISHES_PER_BUSINESS
    )


def check_daily_setup_limit(business_id: int, family_count: int) -> bool:
    today = timezone.localdate().isoformat()
    return _hit_n(
        f"ai_setup_families:{business_id}:{today}", family_count, DAILY_SETUP_FAMILIES_PER_BUSINESS
    )


def monthly_cost_cap_exceeded() -> bool:
    month_start = timezone.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    total = AiUsage.objects.filter(created__gte=month_start).aggregate(total=Sum("est_cost_usd"))[
        "total"
    ]
    return (total or Decimal("0")) >= settings.AI_MONTHLY_CAP_USD


def record_usage(
    *, business, kind: AiUsageKind, model: str, input_tokens: int, output_tokens: int
) -> AiUsage:
    cost = (
        Decimal(input_tokens) / Decimal(1_000_000) * settings.AI_PRICE_IN_PER_MTOK
        + Decimal(output_tokens) / Decimal(1_000_000) * settings.AI_PRICE_OUT_PER_MTOK
    )
    return AiUsage.objects.create(
        business=business,
        kind=kind,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        est_cost_usd=cost,
    )
