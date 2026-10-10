# EasyKharcha

A simple app for single-owner small businesses in India to track what they buy, use and sell.

This is **Step 1 of 8** — foundation and wiring only. One backend health endpoint, one frontend screen
that proves it can reach the backend. Everything else is later steps.

Working rules and the design tokens live in [`CLAUDE.md`](CLAUDE.md).

## Database

**SQLite by default** — `backend/db.sqlite3`, created automatically on first `migrate`. Nothing extra
to install or run for local dev. `docker-compose.yml` at the repo root brings up PostgreSQL for later;
point `DATABASE_URL` at it in `backend/.env` when that's actually wanted — see `backend/.env.example`.

## Prerequisites

Python 3.12+, Node 20+, npm. All commands below are PowerShell, run from the repo root unless noted.

## Backend

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r backend\requirements-dev.txt

cd backend
copy .env.example .env
python manage.py migrate
python manage.py runserver
```

The API is now at `http://127.0.0.1:8000/api/v1/`. Check it directly: `http://127.0.0.1:8000/api/v1/health/`.

## Mobile

In a second terminal, from the repo root:

```powershell
cd mobile
npm install
npm run start
```

Opens `http://localhost:8081`. You should see the EasyKharcha wordmark and a green "Connected to the
server" banner — that needs the backend running too (previous section). Stop the backend and press
"Try again" to see the red banner instead.

`mobile/.env.example` is optional for local dev — the app already defaults to the URL above.

## Checks

With the backend's venv set up (no need for it to be running):

```powershell
npm run check
```

Runs backend lint + format check + `manage.py check` + migrations check, then mobile lint + format
check + type check. Each half can also be run on its own: `npm run check:backend`,
`npm run check:mobile`.

## Smoke test

With **both** the backend and the mobile dev server running (previous two sections):

```powershell
npm run smoke
```

Calls the health endpoint with the mobile app's origin and fails if the response isn't exactly right,
or if the CORS header the browser needs is missing.

## Landing page

`landing/index.html` is a static file — open it directly in a browser, no build step.
