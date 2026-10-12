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
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "accounts",
    "businesses",
    "audit",
    "stock",
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
    "signup_per_ip": (20, 3600),
    "login_per_mobile": (10, 900),
    # Stricter than a password login's — same reasoning as PIN_LOGIN_LOCKOUT_THRESHOLD above.
    "login_per_mobile_pin": (5, 900),
    "login_per_ip": (30, 900),
}

# Step 7: one BusinessSettings row per business, seeded with these at creation. Chosen for a small
# Indian F&B/retail business: a late-morning cutoff for logging yesterday's count, a food-cost
# target in the commonly-cited 28-35% range, and alert thresholds loose enough not to cry wolf on
# normal day-to-day variation.
BUSINESS_SETTINGS_DEFAULTS = {
    "count_deadline_hour": 11,
    "target_cost_pct": 30,
    "wastage_alert_pct": 5,
    "rate_creep_pct": 10,
}
BUSINESS_SETTINGS_RANGES = {
    "count_deadline_hour": (0, 23),
    "target_cost_pct": (1, 100),
    "wastage_alert_pct": (0, 100),
    "rate_creep_pct": (0, 100),
}

# Dev default matches the Expo web dev server exactly (see mobile/package.json's `start` script).
# Override with a comma-separated CORS_ALLOWED_ORIGINS in .env for anything else.
CORS_ALLOWED_ORIGINS = env.list(
    "CORS_ALLOWED_ORIGINS",
    default=["http://localhost:8081", "http://127.0.0.1:8081"],
)
