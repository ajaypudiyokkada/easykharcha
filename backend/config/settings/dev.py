"""Local development settings — SQLite by default, real Redis for Celery.

See docs/DECISIONS.md D-002: this machine has no Docker, so the Compose stack in deploy/ is written but
unexercised. Switching to Postgres is `DATABASE_URL=postgres://...` and nothing else.
"""

from .base import *  # noqa: F403
from .env import env_bool, env_list

DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", ["*"])

# The Expo dev server picks a port at random when 8081 is taken, so dev is permissive here. Prod is not.
CORS_ALLOW_ALL_ORIGINS = True

STORAGES = {  # noqa: F405 — manifest static storage needs collectstatic, which dev does not run
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
