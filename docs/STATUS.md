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
- **Step 8c — Landing page is the public front door.** `/` no longer shows `/login` for a signed-out
  web visitor — it sends them to the landing page instead, a full page navigation out of the app
  (`EXPO_PUBLIC_LANDING_URL`, defaults to `http://localhost:8082`; native still goes straight to
  `/login`, since there's no landing page there). `/login` and `/signup` both gained a quiet "Back to
  website" link (web only). The redirect itself is offline-safe: if the device has no network, a
  retry screen shows instead of handing the browser off to a dead navigation (reusing the same
  `OfflineRetry` component the root layout's auth check already used). `npm run dev` now prints the
  landing URL first. `landing/index.html` itself was not touched this step — only Step 8b's changes
  are in it (verified against git history; see the Step 8c commit message for the diff).
- **Step 8d — Mobile-first responsive design.** Audited every screen at seven widths (320–1920px;
  see `docs/RESPONSIVE_AUDIT.md`) and fixed everything found: a CSS grid overflow in the landing
  page's "who it's for" tiles at 320px, half a dozen sub-44px touch targets (nav/footer links, quiet
  text links, colour/unit/role chips), the landing page showing no wordmark at all on phones, and
  every app screen using the same flat 480px-wide column regardless of viewport (a thin strip on a
  big screen above ~600px). Screens now get purpose-built widths — auth 440px, wizard 640px (steps 2
  and 5 show their preview/role-info panel beside the form at 1024px+), home 720px — and stock/sell/
  team lists go two columns at 900px+. `npm run dev` now also prints this machine's LAN address (the
  backend binds `0.0.0.0`; the app's API base URL and the backend's dev CORS config both key off the
  requesting origin, nothing hardcoded) for testing on a real phone. New `npm run responsive` check.
- **Step 9 — Inner app shell, permissions, Stock and Buy (purchases).** A real permission system
  (`backend/businesses/permissions.py` — see "Permission table" below) replacing the old Owner-only
  checks for the endpoints this step touches. New: `Supplier`, `Purchase`, `PurchaseLine` models,
  soft-deleted purchases, audit-logged before/after on every edit. New screens: the app shell (bottom
  nav on phones, side menu from 840px), Home's real "Bought today"/"Last 7 days" cards, Buy (the
  purchase list + record-purchase sheet), Stock (list with last price paid), Stock item detail (price
  history chart + last 5 purchases). Counts, wastage, sales, reports and alerts are not built yet —
  see "Not built yet". Head chef and Helper get a placeholder Home; nothing else is built for them.

## Permission table

`backend/businesses/permissions.py` is the one place roles map to permission strings — every
business-scoped endpoint checks a permission, never a role name directly. **This is a starting
table, not a final design — it's a decision for the product owner to review**, not something decided
unilaterally:

| Permission | Owner | Manager | Head chef | Helper |
|---|---|---|---|---|
| `purchases.view` | yes | yes | no | no |
| `purchases.create` | yes | yes | no | no |
| `purchases.edit` | yes | no | no | no |
| `purchases.delete` | yes | no | no | no |
| `stock.view` | yes | yes | no | no |
| `team.manage` | yes | no | no | no |
| `settings.manage` | yes | no | no | no |

Head chef and Helper have no permissions yet on purpose — their actual jobs (counting stock,
recording wastage) aren't built as features yet, so there's nothing to grant access to. Once those
exist, this table needs new permissions (e.g. `counts.create`, `wastage.create`) and both roles need
rows filled in, not left empty.

## Route map

Every screen, how it's reached, and where it leads. `/dev/kit` and `/dev/health` are intentionally not
linked from the live app — developer-only tools, reachable only by typing the URL, and they redirect to
`/` outside a development build.

| Screen | Route | Reached from | Leads to |
|---|---|---|---|
| Dispatcher (no UI) | `/` | Typing the URL | Loading screen, then: signed in → wherever `nextRouteAfterAuth` says (`/home`, `/setup/<n>`, or `/setup/done`); signed out on web → the landing page (`EXPO_PUBLIC_LANDING_URL`, a full page navigation out of the app); signed out on native → `/login`. Offline with no stored session → a retry screen, not a dead navigation. |
| Log in | `/login` | The landing page's "Log in"; "New here? Create an account" on `/signup` | On success, wherever `nextRouteAfterAuth` says; "New here?" → `/signup`; "Back to website" (web only) → the landing page |
| Create account | `/signup` | The landing page's "Start free" (hero, nav, sticky); "New here?" on `/login` | On success → `/login` (prefilled, with a banner); "Already have an account?" → `/login`; "Back to website" (web only) → the landing page |
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
