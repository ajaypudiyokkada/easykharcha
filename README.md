# EasyKharcha

A simple app for single-owner small businesses in India to track what they buy, use and sell.

All 8 build steps are done. See [`docs/STATUS.md`](docs/STATUS.md) for exactly what's built and what's
explicitly not (OTP, forgot-password, stock/sales/costing features, and more).

Working rules and the design tokens live in [`CLAUDE.md`](CLAUDE.md).

## Quick start

Once the one-time setup in "Backend" and "Mobile" below is done (venv + `migrate`, `npm install` in
`mobile/`):

```powershell
npm run dev
```

Starts the backend (`http://127.0.0.1:8000`), the app (`http://localhost:8081`) and the landing page
(`http://127.0.0.1:8082`) together, in one terminal, and prints all three URLs. Ctrl+C stops all three.
See `scripts/dev.mjs`.

## Database

**SQLite by default** — `backend/db.sqlite3`, created automatically on first `migrate`. Nothing extra
to install or run for local dev. `docker-compose.yml` at the repo root brings up PostgreSQL for later;
point `DATABASE_URL` at it in `backend/.env` when that's actually wanted — see `backend/.env.example`.

## Prerequisites

Python 3.12+, Node 20+, npm, and a Chromium-based browser (Chrome or Edge) for the flow and pwa-check
scripts. All commands below are PowerShell, run from the repo root unless noted.

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

Opens `http://localhost:8081`. This is the Expo dev server — no service worker is registered here (see
"Production build" below for that).

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

With **just the backend** running:

```powershell
npm run smoke
```

Drives the API directly (signup, login, business setup, stock/sell items, team, settings — the full
backend surface) and fails on the first wrong response shape, status code, or missing CORS header.

## Flow test

With **both** the backend and the mobile dev server (`npm run start`, port 8081) running:

```powershell
npm run flow
```

Drives a real headless browser against the running app: signup → login → all six setup wizard steps →
home, plus a second user who stops mid-wizard and resumes, a third who skips steps, and a team member
logging in with a PIN. Proves the frontend and backend are wired together end to end.

## Production build and PWA / offline check

EasyKharcha installs as a PWA on web: an app manifest, a service worker that caches the app shell for
offline use, and an offline banner that blocks writes while disconnected. None of this runs under the
Expo dev server — it only activates in a production build.

```powershell
npm run build:web   # exports the static web app to mobile/dist
npm run serve:web   # serves mobile/dist at http://127.0.0.1:8082 (localhost only)
```

With that server and the backend both running:

```powershell
npm run pwa-check
```

Headless browser checks against the production build: the manifest loads with the right fields and
icon sizes, the service worker registers and activates, the app shell still opens after a reload while
offline, the offline banner appears and blocks a login attempt with no request sent, and everything
recovers once back online. Screenshots land in `docs/screens/step8/`.

## Landing page

`landing/index.html` is a static file — open it directly in a browser, no build step, or serve it at
`http://127.0.0.1:8082` via `npm run dev` (above). Its "Start free" buttons (hero, nav, sticky mobile
bar) and the nav's "Log in" link point at the running app — `SIGNUP_URL` / `LOGIN_URL` constants at the
top of its own `<script>`. The lead-capture form further down the page is separate and unchanged.

Note: `npm run serve:web` (the production PWA build server, above) also defaults to port 8082 — it's a
separate one-off command for `pwa-check`, not meant to run at the same time as `npm run dev`.
