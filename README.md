# EasyKharcha

Food-cost control for small restaurants. Count what you have, record what you buy and sell, and find
out what went missing.

- **Spec:** [docs/product.md](docs/product.md)
- **Decisions and open questions:** [docs/DECISIONS.md](docs/DECISIONS.md)
- **Working notes for contributors:** [CLAUDE.md](CLAUDE.md)

## Run it locally

Prerequisites: Python 3.12, Node 20, and Redis on `localhost:6379` (only needed for Celery).

### 1. Backend

```bash
python -m venv .venv
.venv\Scripts\activate                 # Windows;  source .venv/bin/activate elsewhere
pip install -r backend/requirements-dev.txt

cd backend
python manage.py migrate

# One Super Admin. No tenant is auto-created — they build the first business in the app.
set SUPERADMIN_PHONE=9999999999 && set SUPERADMIN_NAME=You && set SUPERADMIN_PIN=4321
python manage.py create_superadmin

python manage.py seed_templates --create-canonicals
python manage.py seed_fomo        # FOMO pilot: real ingredients, PLACEHOLDER dishes (DECISIONS D-003)
python manage.py seed_demo        # DEMO tenant with the spec's worked example already recorded

python manage.py runserver 127.0.0.1:8000
```

The database is SQLite at `backend/db.sqlite3`. Switching to Postgres is one environment variable:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/easykharcha
```

### 2. Frontend

```bash
cd mobile
npm install
npx expo start --web --port 8081
```

Open <http://localhost:8081>. The API URL is `expo.extra.apiUrl` in `mobile/app.json`.

### 3. Background jobs (optional)

```bash
cd backend
celery -A config worker -l info --pool=solo    # prefork does not work on Windows
celery -A config beat -l info
```

## Demo logins

`seed_demo` creates the **DEMO Kitchen** tenant. Every PIN is `1234`.

| Phone | Role | What you can see |
|---|---|---|
| 9000000001 | Owner | Everything: report, variance, trends, audit, staff |
| 9000000002 | Manager | Sales, sales import, receive, requests, admin (add only) |
| 9000000003 | Head Chef | Stock, wastage, receive, requests — **no sales, no variance** |
| 9000000004 | Staff | Wastage only |

Sign in as the Head Chef and then the Owner to see the blind-count rule in practice: the same day's
data, two completely different views.

The DEMO data reproduces the spec's §5b worked example. Open **Report → Variance** as the Owner:

```
Chicken boneless   expected 3.480   actual 4.700   wastage 0.300
                   unexplained 0.920 kg (26.44%) = ₹331.20   → alert
```

## Tests

```bash
cd backend && python -m pytest             # 142 tests
cd backend && powershell -File scripts/smoke.ps1   # 41 cross-role API checks, needs the server up

cd mobile  && npx tsc --noEmit
cd mobile  && npm run smoke                # drives a real browser, needs both servers up
```

`npm run smoke` is the one that matters for the client: a typecheck and a successful bundle both pass
on code that crashes on first render. It signs in as the Owner and the Head Chef, walks the screens,
and fails on any console error, any uncaught exception, or any blind-count leak.

## Deployment

`deploy/` holds a Docker Compose stack (Postgres 16, Redis, gunicorn, Celery worker + beat, nginx,
certbot) for a DigitalOcean droplet. **It has never been run** — the development machine has no Docker
(see [DECISIONS D-002](docs/DECISIONS.md)). Before a first deploy:

1. Run the test suite against Postgres, not SQLite.
2. Confirm which purchased domain is primary and substitute it in `deploy/nginx/default.conf`.
3. Fill `deploy/.env` from `deploy/.env.example`.
4. Export the web build: `cd mobile && npx expo export --platform web --output-dir ../deploy/web-build`.

## Status

Backend, business logic and the mobile-web client are complete and tested locally. Known gaps, all
tracked in [docs/DECISIONS.md](docs/DECISIONS.md):

- FOMO's real dish list and prices are placeholders awaiting data.
- The recipe-template library holds only owner-stated values; the wider starter library is unauthored.
- WhatsApp alert delivery is a logging no-op — no BSP chosen.
- The Compose stack and nginx config are unexercised.
