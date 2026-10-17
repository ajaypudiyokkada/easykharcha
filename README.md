# EasyKharcha

A simple app for single-owner small businesses in India to track what they buy, use and sell — stock,
daily counts, wastage, sales and purchases, with alerts when something looks off.

See [`docs/STATUS.md`](docs/STATUS.md) for exactly what's built and what's explicitly not (OTP,
forgot-password, and more). Working rules and the design tokens live in [`CLAUDE.md`](CLAUDE.md).

## Folder map

```
backend/    Django + DRF API
mobile/     Expo / React Native web app
landing/    static public landing page
docs/       specs, design notes and status, written as steps add them
legacy/     an earlier, unrelated product — not used by the current app
```

## Running it

```powershell
npm run dev
```

See "Quick start" below for one-time setup. Other npm commands, all run from the repo root:

| Command | What it does |
| --- | --- |
| `npm run dev` | backend + app + landing page together |
| `npm run check` | backend lint/format/check + mobile lint/format/typecheck |
| `npm run check:backend` / `npm run check:mobile` | either half on its own |
| `npm run smoke` | backend API test (needs just the backend running) |
| `npm run flow` | browser end-to-end test (needs backend + mobile dev server) |
| `npm run responsive` | checks every screen at seven widths |
| `npm run build:web` / `npm run serve:web` | production web export + local server |
| `npm run pwa-check` | offline/service-worker test against the production build |
| `npm run icons` | regenerates PWA/favicon icons |

## Git workflow

GitHub ([ajaypudiyokkada/easykharcha](https://github.com/ajaypudiyokkada/easykharcha), private) is the
repo of record. Nothing is committed straight to `main`: every step is a branch
(`step-<NN>-<short-name>`) off an up-to-date `main`, pushed and opened as a pull request for review and
merge. Full detail in [`CLAUDE.md`](CLAUDE.md#git-workflow).

## Quick start

Once the one-time setup in "Backend" and "Mobile" below is done (venv + `migrate`, `npm install` in
`mobile/`):

```powershell
npm run dev
```

Starts the backend (`http://127.0.0.1:8000`), the app (`http://localhost:8081`) and the landing page
(`http://127.0.0.1:8082`) together, in one terminal, and prints all three URLs — **open the landing
page one**, `http://localhost:8082`, since that's the public front door (see "Landing page" below).
It also prints this machine's LAN address (e.g. `http://192.168.1.5:8081`) for testing on a real
phone — see "Testing on a real phone" below. Ctrl+C stops all three. See `scripts/dev.mjs`.

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

## Responsive check

With the backend and the mobile dev server running (same prerequisite as the flow test, below):

```powershell
npm run responsive
```

Headless browser checks of every screen at seven widths (320–1920px): no horizontal overflow, no
touch target under 44px, no text under 15px (16px for inputs), nothing hidden behind a sticky bottom
bar. Prints a table of any failures and saves one screenshot per screen/width to
`docs/screens/step8d/`. See `docs/RESPONSIVE_AUDIT.md` for what it found before Step 8d's fixes.

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

Drives a real headless browser against the running app: opening "/" signed out lands on the landing
page, whose "Start free" button opens /signup → login → all six setup wizard steps → home, plus a
second user who stops mid-wizard and resumes, a third who skips steps, and a team member logging in
with a PIN. Proves the frontend and backend are wired together end to end. Starts its own throwaway
landing-page server on :8082 if nothing's already there (closed again afterwards).

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

The landing page is the **public front door** — a signed-out visitor who opens the app's own URL ("/")
is sent there automatically, as a full page navigation (not a route inside the app). `/login` and
`/signup` stay directly reachable, and both carry a quiet "Back to website" link back to it.

`landing/index.html` is a static file — open it directly in a browser, no build step, or serve it at
`http://127.0.0.1:8082` via `npm run dev` (above). Its "Start free" buttons (hero, nav, sticky mobile
bar) and the nav's "Log in" link point at the running app — `SIGNUP_URL` / `LOGIN_URL` constants at the
top of its own `<script>`. The lead-capture form further down the page is separate and unchanged.

Note: `npm run serve:web` (the production PWA build server, above) also defaults to port 8082 — it's a
separate one-off command for `pwa-check`, not meant to run at the same time as `npm run dev`.

### Two sites, two URLs — production setup

The landing page and the app are two separate sites, each with its own production URL:

1. **The app's own URL** — wherever `npm run build:web`'s export is actually deployed. Once that's
   known, update `landing/index.html`'s `SIGNUP_URL` / `LOGIN_URL` constants to point at it (they
   default to `http://localhost:8081/...` for local dev).
2. **The landing page's own URL** — wherever `landing/index.html` is actually deployed. Set
   `EXPO_PUBLIC_LANDING_URL` to it in `mobile/.env` (see `mobile/.env.example`) before building the
   app, so a signed-out visitor is sent to the real site instead of `http://localhost:8082`.

## Testing on a real phone

`npm run dev` prints this machine's LAN address alongside the usual `localhost` ones — open that
address on a phone connected to the same Wi-Fi (e.g. `http://192.168.1.5:8081` for the app,
`http://192.168.1.5:8082` for the landing page). Nothing is hardcoded to make this work:

- The backend binds to `0.0.0.0`, not just `127.0.0.1`, so it accepts connections from other devices
  on the network.
- The app's API base URL (`mobile/src/api/client.ts`) defaults to whatever host the page itself was
  loaded from — opening the app at a LAN IP talks to the backend at that same IP automatically, with
  no manual configuration.
- The backend's dev-only CORS config (`backend/config/settings.py`) allows any private-network IP
  (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) on ports 8081/8082, so the browser doesn't block the
  app's requests to the backend.

**The service worker (Step 8's offline support) only works on `localhost` or over HTTPS** — a browser
security restriction, not a bug here. Opening the app at a plain `http://` LAN IP on a phone will work
for everything except offline mode and the "add to home screen" install prompt; testing those for real
needs either `localhost` (so only this machine, not a phone) or a real HTTPS deployment.
