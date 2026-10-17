# Built and run on the server, not on Windows — see deploy/README.md.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=config.settings

WORKDIR /app

# libpq5: the runtime half of psycopg2-binary's bundled Postgres client library.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-prod.txt ./
RUN pip install --no-cache-dir -r requirements-prod.txt

COPY . .

RUN chmod +x entrypoint.sh \
    && addgroup --system app \
    && adduser --system --ingroup app --no-create-home app \
    && mkdir -p /app/staticfiles /app/media \
    && chown -R app:app /app

USER app

# No .env present at build time — settings.py's own defaults (DEBUG=True, sqlite) are enough for
# collectstatic, which never touches the database or ALLOWED_HOSTS.
RUN python manage.py collectstatic --noinput

EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
