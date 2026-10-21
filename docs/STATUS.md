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
- **Step 10 — Stock counts (blind) and wastage.** Head chef and Helper now have real jobs instead of
  a placeholder Home: a Today screen (two big actions, the next deadline, today's entries), a blind
  stock count (`StockCount`/`CountLine` — id/name/unit only, no last count, no expected, no prices;
  the server never sends those fields, rather than the client hiding them), and wastage
  (`WastageEntry`, soft-deleted, audit-logged). An unusually high count value (more than 3x the
  item's recent history or last week's purchases, and only once there's at least one earlier count)
  needs a plain confirm-or-fix dialog before it saves — never showing a number the person didn't type
  themselves. Owner/Manager get Count review (who counted, late or on time, and — once there's an
  earlier count to compare against — bought/wasted/used since then; still no "expected" or "gap"
  field) and a real Wastage screen (today/7-day totals, Owner-only delete). `BusinessSettings` gained
  `closing_count_hour` (default 20) alongside the existing `count_deadline_hour` (default 11, now the
  *opening* deadline). Stock gained "last counted". New shared screen states used everywhere:
  `EmptyState`, `ReadError` (the Step 9 "couldn't load this" component, same thing), `SkeletonList`,
  `NoAccess` (a route guard now shows this instead of silently redirecting), and a session-expired
  dialog on a failed token refresh. Sales, reports and alerts are still not built — see "Not built
  yet".
- **Step 12 — Edit stock items and items sold, Settings screens.** PATCH on stock items and sell
  items (rename, re-price, toggle shared/goes-off, `uses_qty` on a sell item, deactivate — never a
  hard delete); a unit change is refused once the item has a purchase or count, and deactivating a
  stock item is refused while an active sell item still uses it, naming it in the message. New
  permissions `stockitems.manage`/`sellitems.manage`/`business.manage` (Owner only), all writes
  audit-logged with before/after values. New Settings hub and five screens (Business details,
  Brand, What you buy, What you sell, Alert rules), sharing one form component each with the setup
  wizard (`StockItemForm`/`SellItemForm`/`BusinessForm`/`BrandForm`). Stock item detail gained an
  "Edit item" button for the Owner.
- **Step 13 — Team screen, member detail, reset PIN or password.** New `POST team/<id>/reset-secret/`
  (Owner-only, blacklists the member's refresh tokens, clears lockout, never logs the secret); role
  changes between Helper/Head chef are free, crossing the Manager boundary needs a new secret in the
  same PATCH. New `team.view` permission (Manager, list/detail only). `GET team/` now returns
  `last_login_at`/`added_at`. New Team list and member detail screens, replacing the Team stub.
- **Step 14 — Sales (manual) and the stock gap.** New `Sale` model (one row per sell item per
  business date, soft-deleted), `GET/POST sales/` + `DELETE sales/<id>/` with a summary; new
  `sales.view`/`sales.create`/`sales.delete` permissions — see the note below. `GET counts/<id>/`
  lines gained `expected_used`/`gap_qty`/`gap_value`/`gap_status`/`gap_reason` for Owner/Manager
  only, comparing sales against each sell item's `uses_qty`; a line is `flagged` past the new
  `gap_alert_pct` setting (default 10%), and flagged lines surface first in both the list and
  detail. New Sales screen (replacing its ComingSoon stub), Record sales sheet, Count review gap
  display, and a real Home Sales card/stat/quick action plus a setup nudge when `uses_qty` is
  missing. `login_per_ip`'s dev rate limit raised 30 -> 50 for the larger smoke suite.
- **Step 15 — Alerts, and a profile menu.** New `alerts` app: `compute_alerts`/`open_alerts`
  (count_late, price_rise, wastage_high, gap_flagged — computed on read, nothing scheduled),
  `AlertCheck` (hides an alert until its key changes), `GET/POST alerts/`, new `alerts.view`/
  `alerts.check` permissions (Owner/Manager), `GET today/` gained `alerts_count`. Step 14's gap math
  moved to `counts/gap.py` so both counts and alerts share it. New real Alerts screen (filter chips)
  and Alert detail (numbers, primary next action, "Mark as checked"), replacing the ComingSoon stub.
  Home's one-off "Closing count is late" card replaced by a real "Needs attention" (top 4 alerts).
  New profile sheet (avatar/user block -> name, role, business, Switch business, Account placeholder,
  Log out) is now the only place Log out lives — removed from Home for every role.
- **Step 16 — Reports and trends.** New `reports` app: `GET reports/summary/?period=` (one call, six
  blocks — money_went, used_vs_expected, wastage_trend, price_trend, sales_vs_cost, biggest_gaps),
  new `reports.view` permission (Owner/Manager), reusing `counts.gap.lines_with_gap` for every gap
  figure rather than a third implementation. New `BarChart`/`LineChart` (react-native-svg + d3-scale/
  d3-shape/d3-array, 10 small DOM-free packages, ~0.9MB unpacked source; `build:web`'s bundle is
  3.45MB raw / ~608KB gzipped with charts included, no isolated before/after diff taken) alongside
  the existing `PriceChart`. Real Reports screen (period chips, six cards) replaces the ComingSoon
  stub; Home's Money section gained a "Reports" link onto the 7-day period. A 12px axis-tick text
  exemption added to `scripts/responsive_check.mjs`, matching the landing-mockup one. `signup_per_ip`
  raised 20 -> 30 for the larger smoke suite.
- **Step 18 — Expiry alerts.** New `expiry_soon` alert type: for an active, `goes_off` stock item
  with `shelf_life_days` set, a newest-first FIFO walk against the latest count estimates which
  purchase batch is still on hand, flagged danger/warning against the new per-business
  `expiry_warn_days` setting (default 2). Settings hub's "Expiry alerts" row and the landing page's
  matching "coming soon" label are both real now — no other "coming soon" label touched.
- **Step 19 — Item setup: clearer, instant, groupable, robust.** New `StockItem.group`/
  `SellItem.group` (free text, case-insensitively canonicalised per business). The sell-item form's
  "uses" picker explains itself, is searchable/grouped, and can add a brand-new stock item inline
  without leaving the form. Adding a stock/sell item (wizard or Settings) now saves instantly
  (optimistic, rolled back on failure) instead of batching to one submit; Settings' old add-sheet is
  edit-only now, matching the wizard's always-inline add form. Client+server validation tightened
  (shelf life required once "goes off" is on, `uses_qty` must be a real positive number, comma-
  decimals and whitespace-only names rejected) — see `forms/validate*.ts` and `stock/serializers.py`.
  The "goes off" toggle itself was later renamed "Perishable item" in the UI (same field/behaviour).
- **Step 20 — Grouped starter-stock catalogue.** `backend/businesses/starter_packs.json`'s
  `stock_items` now carry `group`/`goes_off`/`shelf_life_days` for all 9 business types (no model
  change — `StockItem` already had these from Step 19). New `StarterStockPicker` (collapsible
  groups, per-group "N of M" + Select all, search, inline "Add your own") replaces setup/3's flat
  tick-list and is also reachable from Settings' "What you buy" ("Add from starter list" sheet).
  Nothing saves until Continue/Next — one bulk request, with a new `skip_existing` flag on
  `stock-items/bulk/` that quietly drops already-there rows instead of erroring the batch, so
  repeating the same picker selection is a no-op. Steps 4–6 of the wizard are unchanged.
- **Step 21a — Django admin for support.** Platform-staff only, unrelated to business roles: `User`
  gained `is_staff`/`is_superuser` (`PermissionsMixin`, default `False`); `businesses/permissions.py`
  never looks at them. Admin lives at env `ADMIN_URL_PATH` (default `manage-ek/`, not `/admin/`),
  behind its own login rate limit (`config/admin_security.py`). Registered: users, businesses,
  access (memberships/roles), stock/sell items, alert checks — editable, no secrets shown, user/
  business delete disabled; counts, purchases, sales, wastage and the audit log are read-only
  (create-only/append-only by design). See `deploy/README.md` for creating/resetting the first admin.
- **Step 21b — Static files refreshed on every deploy.** `entrypoint.sh` now runs `collectstatic
  --noinput` on every container start (not just image build), so the shared `static_files` volume
  Caddy serves `/static/*` from always matches the running build. `deploy.sh` checks
  `https://api.easykharcha.com/static/admin/css/base.css` returns 200 right after the backend's own
  healthcheck passes.
- **Step 21c — Admin password change.** `accounts/admin.py`'s `UserAdmin` adds a "Change password"
  link (reimplementing `django.contrib.auth.admin.UserAdmin`'s own mechanism, since that class is
  tied to `auth.User`'s fields) so a superuser can reset a locked-out/forgotten-password user's
  password from the admin — no hash shown, change logged in the admin log like any other edit.
- **Step 21d — Pincode-based city selection.** New `geo` app: India's ~19K pincodes / ~155K
  pincode-area rows (`load_pincodes`, idempotent, `--if-empty` on every container start),
  `GET geo/pincode/<code>/`. `Business` gained `pincode`/`state`/`country` (kept `city`); create/
  update now cross-checks pincode against city/state unless `manual_location` is set. New
  `PincodeLocationField` (Country fixed, Pincode -> State/City/Area, "Enter city yourself" fallback)
  replaces free-text City in setup step 1 and Settings' Business profile; an existing city-only
  business shows an "Add pincode" prompt instead of a forced change.
- **Step 22 — Sector-aware wording and units.** New `mobile/src/sectorCopy.(json|ts)`: one config
  keyed by all 9 business types for every sector-varying string (stock/sell nouns, placeholders,
  group suggestions, the "uses" picker label/help, shared/goes-off toggle wording, count/wastage
  help) and unit list (`allowedUnits`/`defaultUnit`); `labels.ts` now wraps it, and Head-chef is
  "Head cook" for food types, "Production lead" for small_manufacturing, "Supervisor" otherwise.
  `StockItemForm`/`SellItemForm`/`StarterStockPicker` take a `businessType` prop; unit chips show
  the type's own list first behind a "More units" disclosure, and the goes-off toggle hides under
  "More options" for types that don't default to perishable. `stock.Unit` gained 10 pure-label
  choices (no conversion exists between any unit, so gap maths is unaffected). New
  `scripts/check_sector_copy.py` (in `npm run check`) fails on food wording outside food types or a
  starter-catalogue unit missing from its type's `allowedUnits`.
- **Step 23 — Business-type change asks what to do with existing items.** `BusinessUpdateView`
  PATCH: a `business_type` change with stock/sell items already on the business and no
  `items_action` returns 409 `items_decision_needed` (`businesses/exceptions.py`'s
  `ItemsDecisionNeeded`, item names + counts) instead of silently saving, same shape as counts'
  `NeedsConfirmation`. `items_action: "keep"` just changes the type; `"remove"`
  (`businesses/sector_change.py`) deletes items with no history (purchases/counts/wastage/sales)
  and not still a dish's ingredient, keeping and reporting the rest; one transaction, two
  audit-log actions (`business.update`, `business.sector_change`). New `ChangeBusinessTypeSheet`
  (setup/1 and Settings' Business profile) shows the sheet every time; "Remove" jumps straight to
  the new type's starter list.
- **Step 22a — Dishes carry a portion and multi-ingredient recipe.** Replaced `SellItem`'s single
  `main_stock_item`/`uses_qty` with `SellItemIngredient` (one row per ingredient, qty always in the
  stock item's own unit) plus `portion_label` and `recipe_status` (none/unconfirmed/confirmed);
  existing linked sell items migrated straight to `confirmed`, everything else to `none`. New
  `POST sell-items/` (single dish create with ingredients, always confirmed — a dish needs >=1);
  `sell-items/bulk/` stays ingredients-free (recipe_status=none) and gained `skip_existing`.
  `counts/gap.py`'s `uses_not_set` reason became `recipe_not_confirmed` (names the dish(es)); gap
  maths, Reports' `sales_vs_cost` and sector-change's "still in use" check all now go through
  ingredients and only trust `confirmed` recipes. New `DishRecipeForm` (name/portion/group/
  multi-ingredient picker with a grouped+searchable list, inline "add a new item", and a g<->kg/
  ml<->L client-side unit-conversion hint — `mobile/src/forms/unitConversion.ts`, the app's only
  unit conversion, purely at entry time) drives Settings' "Add {label}"/edit sheet; the wizard's
  own quick-add (`SellItemForm`) stays ingredients-free. Settings' dish list shows "Needs
  ingredients"/"Estimate - confirm" badges; Home gained an owner-only "Add ingredients to N dishes"
  nudge (`?filter=needs_ingredients` on Settings' dish list), replacing the old uses_qty nudge.
- **Step 23a — Owner can do everything.** `ALL_PERMISSIONS` in `backend/businesses/permissions.py`
  is now the single registry every permission string must come from; the Owner's set is computed
  as `ALL_PERMISSIONS`, not hand-listed, so it automatically carries `counts.status` and
  `wastage.view_own` too (it didn't before) — `GET today/`'s team-progress block, previously
  Head-chef-only, now also shows for the Owner. Manager/Head chef/Helper unchanged.
  `scripts/smoke.py`'s new `check_permission_table` fails if the Owner ever drifts from
  `ALL_PERMISSIONS`, and prints the role table.

## Permission table

`backend/businesses/permissions.py` is the one place roles map to permission strings — every
business-scoped endpoint checks a permission, never a role name directly. Step 23a: the Owner's
column is `ALL_PERMISSIONS` computed, not hand-listed — restrictions only apply to the three roles
below it, and a permission added for any of them reaches the Owner automatically. Manager/Head
chef/Helper are still a draft, a decision for the product owner to review, not decided unilaterally:

| Permission | Owner | Manager | Head chef | Helper |
|---|---|---|---|---|
| `purchases.view` | yes | yes | no | no |
| `purchases.create` | yes | yes | no | no |
| `purchases.edit` | yes | no | no | no |
| `purchases.delete` | yes | no | no | no |
| `stock.view` | yes | yes | no | no |
| `team.manage` | yes | no | no | no |
| `team.view` | yes | yes | no | no |
| `settings.manage` | yes | no | no | no |
| `stockitems.manage` | yes | no | no | no |
| `sellitems.manage` | yes | no | no | no |
| `business.manage` | yes | no | no | no |
| `counts.create` | yes | no | yes | yes |
| `counts.review` | yes | yes | no | no |
| `counts.status` | yes | no | yes | no |
| `wastage.create` | yes | no | yes | yes |
| `wastage.view_all` | yes | yes | yes | no |
| `wastage.view_own` | yes | no | no | yes |
| `wastage.view_value` | yes | yes | no | no |
| `wastage.delete` | yes | no | no | no |
| `sales.view` | yes | yes | no | no |
| `sales.create` | yes | yes | no | no |
| `sales.delete` | yes | no | no | no |

Notes for the product owner, not decided unilaterally:
- **Manager has `counts.review` but not `counts.create`, and `wastage.view_all`/`wastage.view_value`
  but not `wastage.create`** — matches the design (Manager oversees, doesn't do the daily physical
  jobs). Worth confirming that's actually the intended split and not just what the design happened to
  show.
- **`counts.status` (team-wide "X of Y items counted today") is Head-chef- and Owner-only, not
  Manager** — Helper's Today screen only ever shows their own task, never team-wide numbers. This is
  a real, deliberate distinction from `counts.create` (which Head chef and Helper both have), not an
  oversight.
- **The late-count reminder (`POST counts/remind/`) is hardcoded Owner-only on the server** — there's
  no permission string for it, the same way `team.manage`/`settings.manage` writes already were
  before this table existed. Worth deciding if that should become a real permission instead.
- **Settings** gained `closing_count_hour` (default 20, i.e. 8 PM) alongside the existing
  `count_deadline_hour` (default 11 AM, now specifically the *opening* count's deadline) — both still
  Owner-only to view or change.
- **Step 14: `sales.view`/`sales.create` given to Manager, `sales.delete` kept Owner-only** —
  mirrors the purchases split (Manager records, Owner is the only one who can undo a record), not
  something decided unilaterally. Head chef and Helper get neither: sales recording was built as an
  Owner/Manager job, the same way counts/wastage were built as a Head-chef/Helper job — worth
  confirming that's the intended shape, not just what was easiest to build.

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
- **Forced change on first login** — `must_change_password` is set and cleared by the Owner's
  add/reset/role-change flows, but nothing in the login flow actually prompts a Manager to change it.
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
- **Account screen's "Switch business"** — the profile sheet's picker only reorders the signed-in
  user's own `businesses` list client-side (so the rest of the app treats the chosen one as current);
  there's no dedicated multi-business management screen.
- **Sales file upload (Petpooja)** — Step 14 deliberately built manual sales entry only, no upload
  button or upload screen; a later step may add bulk/file-based sales import.
- **AI/scan recipe estimation** — Step 22a deliberately built the manual dish-recipe path only, no
  "scan your menu" card or choice screen before "Add what you sell"; `RecipeStatus.UNCONFIRMED` and
  `DishRecipeForm`'s `stepLabel`/`onSkip` card-flow props exist as extension points but nothing
  creates or drives them yet — see `docs/MAP.md`'s `stock/` entry.
