"""A small fixed-window rate limiter on Django's cache framework — no new dependency.

Dev default is LocMemCache, which is per-process: fine for a single `runserver`, not for multiple
worker processes. Point CACHES at Redis before running more than one process in production.
"""

from django.core.cache import cache


def hit(key: str, limit: int, window_seconds: int) -> bool:
    """Record one attempt for `key`. Returns False once `limit` attempts have been recorded inside
    the current window, True otherwise."""
    cache_key = f"ratelimit:{key}"
    count = cache.get(cache_key)
    if count is None:
        cache.set(cache_key, 1, timeout=window_seconds)
        return True
    if count >= limit:
        return False
    cache.incr(cache_key)
    return True


def get_client_ip(request) -> str:
    return request.META.get("REMOTE_ADDR", "")
