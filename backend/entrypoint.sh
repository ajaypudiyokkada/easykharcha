#!/bin/sh
# Runs on every container start (not just the first) — migrate is a no-op once the schema is
# current, so this is safe to repeat on every restart/redeploy.
set -e

python manage.py migrate --noinput

exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers 2 \
    --access-logfile - \
    --error-logfile -
