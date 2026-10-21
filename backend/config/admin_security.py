from django.conf import settings
from django.http import HttpResponseForbidden

from accounts.ratelimit import get_client_ip, hit


class AdminLoginRateLimitMiddleware:
    """Throttles POSTs to the Django admin login page, the same fixed-window way accounts/ratelimit.py
    throttles the app's own login endpoint — the admin login view has no rate limiting of its own."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.login_path = f"/{settings.ADMIN_URL_PATH}login/"

    def __call__(self, request):
        if request.method == "POST" and request.path == self.login_path:
            ip = get_client_ip(request)
            limit, window = settings.RATE_LIMITS["admin_login_per_ip"]
            if not hit(f"admin_login:ip:{ip}", limit, window):
                return HttpResponseForbidden("Too many login attempts. Try again later.")
        return self.get_response(request)
