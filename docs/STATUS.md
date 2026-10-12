# Status

All 8 build steps are done. This lists what each step shipped, and — separately — what's explicitly
not built yet.

## Built

- **Step 1 — Foundation.** Django + DRF backend, Expo + expo-router + react-native-web frontend, one
  health endpoint, one screen that proves the frontend can reach it.
- **Step 2 — Design system.** Colour/spacing/radius/type tokens (`mobile/src/theme/tokens.ts`), the
  component kit (`Button`, `TextField`, `Banner`, `Card`, `Toggle`, `Checkbox`, `Screen`, etc.), bundled
  Poppins/Nunito Sans fonts, the `/dev/kit` screen.
- **Step 3 — Accounts.** Signup, login, logout, access/refresh token auth, the `User` model, rate
  limiting on auth endpoints.
- **Step 4 — Business setup, steps 1–2.** Create a business (name, city, type), brand colour with a
  contrast-safe preview, logo upload.
- **Step 5 — Business setup, steps 3–4.** Starter stock items + custom stock items (step 3), starter
  sell items + custom sell items linked to stock (step 4), bulk save with per-row validation errors.
- **Step 6 — Business setup, step 5 (team).** Add team members (Manager/Helper) by mobile number, PIN
  login for team members, role-based access (403/404 on endpoints a role shouldn't reach).
- **Step 7 — Business setup, step 6 (alerts) and completion.** Wastage/price-rise alert thresholds,
  "Use recommended settings", `/setup/done` and `/home` summaries, resuming a skipped wizard step.
- **Step 8 — Installable app shell (PWA) and offline message.** Web manifest + generated icons (192,
  512, maskable 512, apple-touch-icon), a hand-written service worker that caches the app shell and
  bundled fonts (never the API, auth, or uploaded media), an update-available banner with no forced
  reload, an offline hook + persistent offline banner, every write blocked while offline with no
  request sent, the auth bootstrap check treating "offline" as distinct from "signed out" (stored
  tokens are kept), safe-area padding, a friendly 404 screen, a production build
  (`npm run build:web` / `npm run serve:web`) and an automated `npm run pwa-check`.
- **Step 8b — Stitch everything together.** `/` is now the real app (loading screen, then routes to
  `/login` or wherever a signed-in user belongs) instead of the Step 1 health check, which moved to
  `/dev/health` (dev builds only). The landing page's "Start free" and new "Log in" buttons point at
  the real app. `npm run dev` starts the backend, the app and a landing-page server together. Fixed a
  layout bug found while checking this at desktop widths: `BottomActionBar` (the sticky "Next"/"Log
  in"/etc. bar) was pinned flush to the left edge above 480px instead of staying in the centred column
  — `Screen.tsx`'s `barWrap` had `left`, `right` and `maxWidth` all set at once, which is
  over-constrained and resolves flush-left, not centred. See the route map below.

## Route map

Every screen, how it's reached, and where it leads. `/dev/kit` and `/dev/health` are intentionally not
linked from the live app — developer-only tools, reachable only by typing the URL, and they redirect to
`/` outside a development build.

| Screen | Route | Reached from | Leads to |
|---|---|---|---|
| Dispatcher (no UI) | `/` | Typing the URL; the landing page's old in-app links | Loading screen, then `/login` (signed out) or wherever `nextRouteAfterAuth` says a signed-in user belongs (`/home`, `/setup/<n>`, or `/setup/done`) |
| Log in | `/login` | `/` when signed out; "New here? Create an account" on `/signup`; the landing page's "Log in" | On success, wherever `nextRouteAfterAuth` says; "New here?" → `/signup` |
| Create account | `/signup` | "New here?" on `/login`; the landing page's "Start free" (hero, nav, sticky) | On success → `/login` (prefilled, with a banner); "Already have an account?" → `/login` |
| Home | `/home` | Post-login/signup once onboarded; "Go to Home" on `/setup/done`; "Save and finish later" on any setup step | "Continue" on a skipped step in the checklist → `/setup/<n>`; "Log out" → `/login` |
| Setup steps 1–6 | `/setup/1` … `/setup/6` | `nextRouteAfterAuth` resuming a wizard in progress; Next/Back between steps; `/home`'s "Finish setting up" checklist | Next step, previous step, `/home` ("finish later"), or `/setup/done` after step 6 |
| Setup done | `/setup/done` | Finishing or skipping step 6 | "Go to Home" → `/home`; "Add today's opening stock" is disabled with a "Coming soon" label (stock tracking isn't built yet — see Not built yet) |
| Component kit (dev) | `/dev/kit` | Typing the URL in a dev build | Not part of the real app's navigation |
| Health check (dev) | `/dev/health` | Typing the URL in a dev build | Not part of the real app's navigation |
| Not found | any unknown path | A bad or stale link | "Go to Home" → `/home` |

**Dead ends found:** the root route itself — `/` showed the Step 1 health screen with nothing that led
into the app, and the landing page's signup buttons only scrolled to its own lead-capture form instead
of reaching the real app. Both are fixed above. Nothing else goes nowhere: the signup screen's
Privacy/Terms text and `/setup/done`'s opening-stock button are both deliberately inert, not broken, and
both say so in the UI.

## Not built yet

- **OTP provider** — signup/login use a password/PIN only; no SMS OTP integration.
- **Forgot password** — no reset flow of any kind.
- **PIN change and forced password change** — a team member's PIN and an owner's password can be set
  once (signup, add-team) but never changed afterwards; no forced-change-on-first-login flow.
- **Account screen** — no screen to change your own password, or to request account deletion.
- **Logo delete** — a business logo can be uploaded and replaced, but not removed back to no logo.
- **Per-process rate limiting across multiple workers** — the current rate limiter is in-process memory;
  it needs a shared cache (e.g. Redis) before running behind more than one worker process.
- **Privacy / terms URLs** — not set, so the signup consent checkbox shows "Privacy policy" and
  "Terms" as plain muted text, not a link (`mobile/src/config.ts`'s `LegalLink` already degrades to
  this on purpose rather than linking to a placeholder — set `EXPO_PUBLIC_PRIVACY_URL` /
  `EXPO_PUBLIC_TERMS_URL` once real pages exist).
- **A legacy/ code reuse plan** — `legacy/` (the earlier multi-tenant restaurant SaaS build) is kept
  intact and untouched; nothing in the current app reads from or depends on it, and no decision has
  been made about reusing any of its code. Do not delete it.
- **Stock, sales and costing features** — the setup wizard records starter/custom stock and sell items,
  but there is no screen yet to record daily purchases, sales, wastage, or to see costing/margin
  reports. That's the next phase of the product, not part of these 8 steps.
