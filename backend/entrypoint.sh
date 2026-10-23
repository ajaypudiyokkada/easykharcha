#!/bin/sh
# Runs on every container start (not just the first) — migrate is a no-op once the schema is
# current, so this is safe to repeat on every restart/redeploy. Only the backend service does this
# (RUN_SETUP unset/not "0") — the worker service sets RUN_SETUP=0 so two containers never migrate at
# the same time; it also `depends_on` the backend's healthcheck so it never starts before the schema
# it needs exists.
set -e

if [ "$RUN_SETUP" != "0" ]; then
    python manage.py migrate --noinput
    # Only loads the ~155K-row pincode table when it's actually empty (a fresh database) — reloading
    # it on every restart would be wasted work for data that never changes between deploys.
    python manage.py load_pincodes --if-empty
    # Re-run on every start (not just image build) so the shared static_files volume — read by
    # Caddy, not Django, in production — always matches this build's code, e.g. a newly added
    # django.contrib.admin static asset or an icon change, even when the volume already existed
    # from a prior image.
    python manage.py collectstatic --noinput
fi

# A command passed in (e.g. the worker's `command: python manage.py run_ai_jobs`) runs as-is; with
# none given (the backend service), fall through to gunicorn.
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers 2 \
    --access-logfile - \
    --error-logfile -
