"""Settings shared by every environment.

Everything environment-specific is read from the environment (see `.env.example`); the dev and prod
modules only override what genuinely differs.
"""

from datetime import timedelta
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

from .env import env_bool, env_int, env_list, env_str

BASE_DIR = Path(__file__).resolve().parent.parent.parent
REPO_DIR = BASE_DIR.parent

load_dotenv(REPO_DIR / ".env")
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = env_str("DJANGO_SECRET_KEY", "dev-only-insecure-key-change-me")
DEBUG = env_bool("DJANGO_DEBUG", False)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", ["localhost", "127.0.0.1"])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # third party
    "rest_framework",
    "corsheaders",
    "django_filters",
    # local
    "core",
    "accounts",
    "tenants",
    "inventory",
    "recipes",
    "imports",
    "reports",
    "audit",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": dj_database_url.parse(
        env_str("DATABASE_URL", f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
        conn_max_age=env_int("DB_CONN_MAX_AGE", 600),
    )
}

AUTH_USER_MODEL = "accounts.User"

# The PIN is a short numeric secret, not a password. It is hashed with Django's hashers and the
# length/complexity validators are deliberately off — the brute-force defence is rate limiting on the
# login endpoint (see accounts.views.LoginView), not entropy.
AUTH_PASSWORD_VALIDATORS: list[dict] = []
PIN_LENGTH = env_int("PIN_LENGTH", 4)

LANGUAGE_CODE = "en-in"
TIME_ZONE = env_str("DJANGO_TIME_ZONE", "Asia/Kolkata")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_FILTER_BACKENDS": ("django_filters.rest_framework.DjangoFilterBackend",),
    "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
    "EXCEPTION_HANDLER": "core.exceptions.exception_handler",
    "DEFAULT_PAGINATION_CLASS": "core.pagination.DefaultPagination",
    "PAGE_SIZE": 100,
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
    "DEFAULT_THROTTLE_CLASSES": (),
    # A 4-digit PIN has 10k combinations, so the login endpoint is the brute-force surface. The rate
    # limit is the defence, not PIN entropy — see the AUTH_PASSWORD_VALIDATORS note above.
    "DEFAULT_THROTTLE_RATES": {"login": env_str("LOGIN_THROTTLE_RATE", "10/min")},
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env_int("JWT_ACCESS_MINUTES", 60)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env_int("JWT_REFRESH_DAYS", 30)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": False,
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    # Non-negotiable #3: the token carries identity only. Roles are resolved from the Access table on
    # every request, so a revoked grant takes effect immediately rather than at token expiry.
}

CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS",
    ["http://localhost:8081", "http://127.0.0.1:8081", "http://localhost:19006"],
)
CORS_ALLOW_CREDENTIALS = False

CELERY_BROKER_URL = env_str("REDIS_URL", "redis://127.0.0.1:6379/0")
CELERY_RESULT_BACKEND = env_str("REDIS_URL", "redis://127.0.0.1:6379/0")
CELERY_TASK_ALWAYS_EAGER = env_bool("CELERY_TASK_ALWAYS_EAGER", False)
CELERY_TIMEZONE = TIME_ZONE
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]

# Outbound alert delivery. "logging" is the only implementation that works — see reports/notifiers.py
# and docs/DECISIONS.md O-7 (no WhatsApp BSP chosen yet).
ALERT_NOTIFIER = env_str("ALERT_NOTIFIER", "logging")

# Hour of the local day at which the SLA sweep runs. The sweep itself re-checks each tenant's own
# sla_hours, so this only needs to be often enough to catch the earliest tenant deadline.
SLA_SWEEP_MINUTE = env_int("SLA_SWEEP_MINUTE", 0)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"simple": {"format": "{levelname} {name} {message}", "style": "{"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "simple"}},
    "root": {"handlers": ["console"], "level": env_str("LOG_LEVEL", "INFO")},
}
