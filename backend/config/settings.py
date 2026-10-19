"""Settings for EasyKharcha.

One file, not a base/dev/prod split — Step 1 is foundation only. Everything that differs between a
laptop and a real deployment is read from the environment, not from which file gets imported.
"""

from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, True),
)
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env.str("DJANGO_SECRET_KEY", default="dev-only-insecure-key-change-me")
DEBUG = env.bool("DEBUG", default=True)
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["*"] if DEBUG else [])

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "accounts",
    "businesses",
    "audit",
    "stock",
    "purchases",
    "counts",
    "wastage",
    "sales",
    "alerts",
    "reports",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# SQLite by default so a clean clone needs nothing extra. Set DATABASE_URL to point at the Postgres
# in docker-compose.yml when that's actually wanted — see README.
DATABASES = {
    "default": env.db("DATABASE_URL", default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
}

AUTH_USER_MODEL = "accounts.User"

# Uploaded files are runtime data, not source code: gitignored (see .gitignore's `media/` entry) and
# overridable so a real deployment can point this at a storage volume outside the deployed code tree
# entirely, the same way DATABASE_URL overrides the dev sqlite default above.
MEDIA_ROOT = env.str("MEDIA_ROOT", default=str(BASE_DIR / "media"))
MEDIA_URL = "/media/"

# Collected at image build time (Step 17's backend/Dockerfile) into a volume Caddy serves directly —
# Django itself never serves these in production.
STATIC_URL = "/static/"
STATIC_ROOT = env.str("STATIC_ROOT", default=str(BASE_DIR / "staticfiles"))

# Argon2 first (used for every new hash); the rest are Django's own defaults, kept only so a password
# hashed by a prior algorithm would still verify — there are none yet, since this user model is new.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]

LANGUAGE_CODE = "en-in"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    # JWT only — no SessionAuthentication, so contrib.sessions is still not needed.
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.AllowAny",),
    "EXCEPTION_HANDLER": "config.exceptions.exception_handler",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env.int("JWT_ACCESS_MINUTES", default=60)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("JWT_REFRESH_DAYS", default=30)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

# Shown to the user at signup; stored on the user as consent_version so a later change to the
# consent text can be told apart from what an existing user actually agreed to.
CONSENT_VERSION = env.str("CONSENT_VERSION", default="1.0")

# Interface + flag only (accounts/otp.py) — no OTP endpoint exists yet, so this has no effect yet.
OTP_REQUIRED = env.bool("OTP_REQUIRED", default=False)

LOGIN_LOCKOUT_THRESHOLD = 5
# A 4-6 digit PIN has far fewer combinations than a password, so a PIN account locks out sooner.
PIN_LOGIN_LOCKOUT_THRESHOLD = 3
LOGIN_LOCKOUT_MINUTES = 15

MAX_BUSINESSES_PER_USER = env.int("MAX_BUSINESSES_PER_USER", default=3)
MAX_LOGO_UPLOAD_BYTES = 2 * 1024 * 1024
MAX_TEAM_MEMBERS_PER_BUSINESS = env.int("MAX_TEAM_MEMBERS_PER_BUSINESS", default=10)

# (attempts, window in seconds). Dev-only LocMemCache backs this — see accounts/ratelimit.py.
RATE_LIMITS = {
    "signup_per_mobile": (5, 3600),
    # Step 16's reports smoke checks add 2 more signups (their own business, plus a brand-new one for
    # the empty-state check) on top of the ~17 the suite already made on one shared dev IP — raised
    # from 20 so the full `npm run smoke` run doesn't trip its own rate limit, same reasoning as
    # login_per_ip below.
    "signup_per_ip": (30, 3600),
    "login_per_mobile": (10, 900),
    # Stricter than a password login's — same reasoning as PIN_LOGIN_LOCKOUT_THRESHOLD above.
    "login_per_mobile_pin": (5, 900),
    # Step 14's smoke suite alone makes 33 login calls across its role-switch scenarios (one shared
    # dev IP) — raised from 30 so the full `npm run smoke` run doesn't trip its own rate limit.
    "login_per_ip": (50, 900),
}

# Step 7: one BusinessSettings row per business, seeded with these at creation. Chosen for a small
# Indian F&B/retail business: a late-morning cutoff for logging yesterday's count, a food-cost
# target in the commonly-cited 28-35% range, and alert thresholds loose enough not to cry wolf on
# normal day-to-day variation.
BUSINESS_SETTINGS_DEFAULTS = {
    "count_deadline_hour": 11,
    "closing_count_hour": 20,
    "target_cost_pct": 30,
    "wastage_alert_pct": 5,
    "rate_creep_pct": 10,
    "gap_alert_pct": 10,
    "expiry_warn_days": 2,
}
BUSINESS_SETTINGS_RANGES = {
    "count_deadline_hour": (0, 23),
    "closing_count_hour": (0, 23),
    "target_cost_pct": (1, 100),
    "wastage_alert_pct": (0, 100),
    "rate_creep_pct": (0, 100),
    "gap_alert_pct": (0, 100),
    "expiry_warn_days": (1, 30),
}

# Dev default matches the Expo web dev server (mobile/package.json's `start` script, :8081) and the
# production web export served locally for service-worker testing (scripts/serve_web.mjs, :8082).
# Override with a comma-separated CORS_ALLOWED_ORIGINS in .env for anything else.
CORS_ALLOWED_ORIGINS = env.list(
    "CORS_ALLOWED_ORIGINS",
    default=[
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:8082",
        "http://127.0.0.1:8082",
    ],
)

# Step 8d: lets a phone on the same Wi-Fi reach the dev server at this machine's LAN IP (printed by
# `npm run dev`) without hardcoding that address anywhere. Private-network ranges only, and only in
# DEBUG — never matched in a real deployment, where CORS_ALLOWED_ORIGINS above should be set instead.
if DEBUG:
    CORS_ALLOWED_ORIGIN_REGEXES = [
        r"^http://192\.168\.\d{1,3}\.\d{1,3}:(8081|8082)$",
        r"^http://10\.\d{1,3}\.\d{1,3}\.\d{1,3}:(8081|8082)$",
        r"^http://172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}:(8081|8082)$",
    ]

# Step 17: production-only. None of this is reachable with the DEBUG default (True), so local dev and
# `npm run smoke`/`flow` (which make dozens of rapid signup/login calls) are unaffected.
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

# LocMemCache (Django's default, used above implicitly until now) is per-process — fine for one
# `runserver`, not for gunicorn's 2 worker processes in production, which don't share memory and would
# each enforce accounts/ratelimit.py's login/signup limits independently. A file cache on the
# container's own filesystem is shared by every worker in the same container, with nothing extra to
# run (no Redis) — light on a 1 vCPU / 2 GB droplet.
CACHE_BACKEND = env.str("CACHE_BACKEND", default="django.core.cache.backends.locmem.LocMemCache")
CACHES = {"default": {"BACKEND": CACHE_BACKEND}}
if "filebased" in CACHE_BACKEND:
    CACHES["default"]["LOCATION"] = env.str("CACHE_LOCATION", default="/tmp/easykharcha_cache")

if not DEBUG:
    # Caddy terminates TLS and forwards plain HTTP internally — this is how Django knows the original
    # request was actually HTTPS (for secure cookies, HSTS, request.is_secure()).
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

    SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=2592000)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = False

    # A general safety net across the whole API, independent of and in addition to the
    # signup/login-specific limits in accounts/views.py — shares the same cache above, so it's
    # consistent across both gunicorn workers too.
    REST_FRAMEWORK["DEFAULT_THROTTLE_CLASSES"] = ["rest_framework.throttling.AnonRateThrottle"]
    REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {"anon": env.str("API_RATE_LIMIT", default="30/min")}
