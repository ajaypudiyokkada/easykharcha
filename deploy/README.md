# Deployment

**Status: written, never run.** The development machine has no Docker and no WSL2, so this stack has
not been brought up even once (see [../docs/DECISIONS.md](../docs/DECISIONS.md) D-002). Treat every
command below as untested and expect to debug it on first use.

Two things must be answered before a first deploy, both the owner's call:

- **O-4** — which purchased domain (.com / .ai / .in) is primary. `nginx/default.conf` and
  `DJANGO_ALLOWED_HOSTS` both carry `app.example.com` as a placeholder.
- **O-5** — the DigitalOcean droplet and its credentials. Nothing here touches them.

## First deploy

```bash
# 1. On the droplet
git clone <repo> easykharcha && cd easykharcha/deploy
cp .env.example .env && $EDITOR .env          # fill in secrets; never commit this file

# 2. Substitute the real domain
sed -i 's/app.example.com/<your-domain>/g' nginx/default.conf

# 3. Build the web client (needs Node; can also be built in CI and copied up)
cd ../mobile && npm ci
npx expo export --platform web --output-dir ../deploy/web-build
cd ../deploy

# 4. Certificate — one-off, before nginx can start on 443
docker compose up -d postgres redis web
docker compose run --rm --entrypoint "certbot certonly --webroot -w /var/www/certbot \
  -d <your-domain> --email <you> --agree-tos --no-eff-email" certbot

# 5. Everything up
docker compose up -d

# 6. Bootstrap — one Super Admin, no auto-created tenant
docker compose exec web python manage.py create_superadmin
docker compose exec web python manage.py seed_templates --create-canonicals
```

Then sign in as the Super Admin and create the first business through the app.

## Before you trust it

Run the test suite against **Postgres**, not SQLite. Local development uses SQLite, which does not
reproduce Postgres behaviour on constraint timing, row locking (`select_for_update` in
`inventory/services.py` is a no-op on SQLite), or decimal precision. CI already does this — check that
it is green on the commit you are deploying.

```bash
docker compose exec web python -m pytest
```

## Updating

```bash
git pull
docker compose build web worker beat
docker compose up -d
# migrate + collectstatic run automatically in the web container's start command
```

## What is not here

- No backup job. Add `pg_dump` on a cron to object storage before real client data goes in.
- No log shipping or monitoring.
- `ALERT_NOTIFIER=logging` is the only working notifier. WhatsApp needs a BSP (DECISIONS O-7), and
  group automation is not feasible at all — Meta caps business-created groups at 8 participants.
