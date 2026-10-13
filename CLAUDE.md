# EasyKharcha — working rules

A simple app for single-owner small businesses in India to track what they buy, use and sell.
Built in small, numbered steps — each step does exactly what it says and stops there.

Stack: Django 5 + DRF (`backend/`), Expo + TypeScript + expo-router + react-native-web (`mobile/`),
web first. Development is on Windows with PowerShell — every command and script must work there.

## Working rules

- **Scripts, not one-off commands.** Put any check, data, or verification script in a file and run it
  with a named command — `npm run check`, `python scripts/smoke.py`, a `manage.py` subcommand. Never
  `node -e`, never a PowerShell here-string, never an inline throwaway script.
- **Light checking only.** No test suites. The only checks are: lint, type check, formatting, Django's
  own `check` and `makemigrations --check`, the smoke script (backend API) and flow script (browser
  end-to-end) that prove the frontend and backend work together, the pwa-check script that proves the
  offline/service-worker behaviour, and the responsive script that checks every screen at seven widths.
  Keep it fast.
- **Don't add scope.** Build exactly what the current step asks for, nothing it doesn't mention. Flag
  gaps and open questions instead of guessing past them.
- **Don't push to git.** Local commits are fine when asked for; nothing leaves this machine on its own.

## Colour, font and spacing tokens

Everything a screen draws comes from `mobile/src/theme/tokens.ts` — colours, spacing, radii, type
sizes, font family names. **Nothing is hard-coded in a screen.** The colour set is closed; don't add or
change a colour without the spec asking for it. Fonts are Poppins (headings) and Nunito Sans (body),
bundled locally via `expo-font` + `@expo-google-fonts/*` — never a CDN `<link>`, since the app must
render correctly with no network access at all.

## Layout

```
backend/    Django project — config/ (settings, urls) + accounts/ (the User model only, so far)
mobile/     Expo app — app/ (screens), src/theme/ (tokens), src/api/ (the fetch wrapper)
landing/    static landing page — the public front door; copied in unmodified at Step 1. Step 8b
            wired its sign-up/login buttons at the running app; Step 8d adjusted only its layout and
            responsive CSS (mobile-first, touch targets, a slim mobile header) — see docs/STATUS.md
docs/       specs and design files, written as steps add them
legacy/     a previous, larger multi-tenant build of a different EasyKharcha product — see below
scripts/    dev.mjs (backend + app + landing page together), smoke.py (backend API proof), flow.mjs
            (browser end-to-end), check_backend.ps1 (backend lint/format/check), generate_icons.mjs
            (PWA icons), serve_web.mjs (serves the production web export locally), pwa_check.mjs
            (offline/service-worker proof), responsive_check.mjs (checks every screen at seven
            widths), lib/landing_server.mjs (shared by dev.mjs, flow.mjs and responsive_check.mjs)
```

## `legacy/`

Step 1 started with this folder already containing a full, different product: a multi-tenant
restaurant food-cost SaaS (roles, recipe variance, POS import, 170 tests) built under an earlier brief.
It doesn't match this step's spec — different `accounts.User` shape, different design tokens, different
API prefix — and the app label (`accounts`) and folder names (`backend/`, `mobile/`) would have
collided with a fresh build in place. Nothing was deleted: the whole thing moved into `legacy/` intact
(git history preserved via `git mv` where tracked), and Step 1 was built fresh at the root. Nothing in
`legacy/` is used by or referenced from the current app.

## Database

SQLite by default (`backend/db.sqlite3`) — nothing extra needed for local dev. `docker-compose.yml` at
the repo root brings up Postgres for later; switching is a `DATABASE_URL` change in `backend/.env`, not
a restructure. See `README.md` for which one is actually in use right now.

## Error shape

Every API error comes back as `{"error": {"code": "...", "message": "..."}}`, set up once in
`backend/config/exceptions.py` as the DRF exception handler. No endpoint builds its own error shape.

## How to work in this repo (read before anything else)
- Read docs/MAP.md first. It says where every screen, endpoint, component
  and script lives. Do not search the repo or spawn agents to explore;
  open only the files MAP.md points you to for the current step.
- Never read legacy/, node_modules/, docs/screens/, or the design HTML
  files. Use docs/design/DESIGN_NOTES.md instead of the HTML.
- After each step, update docs/MAP.md and docs/STATUS.md in 10 lines or
  fewer each. Keep them short; they are read on every step.
- Run checks once at the end of a step, not after every file edit.