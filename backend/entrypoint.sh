#!/bin/sh
# Runs on every container start (not just the first) — migrate is a no-op once the schema is
# current, so this is safe to repeat on every restart/redeploy.
set -e

python manage.py migrate --noinput
# Only loads the ~155K-row pincode table when it's actually empty (a fresh database) — reloading it
# on every restart would be wasted work for data that never changes between deploys.
python manage.py load_pincodes --if-empty
# Re-run on every start (not just image build) so the shared static_files volume — read by Caddy,
# not Django, in production — always matches this build's code, e.g. a newly added django.contrib.admin
# static asset or an icon change, even when the volume already existed from a prior image.
python manage.py collectstatic --noinput

exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers 2 \
    --access-logfile - \
    --error-logfile -
