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
  unit conversion, purely at entry time) drives Settings' "Add {label}"/edit sheet (Step 22a2 also
  wires onboarding into it). Settings' dish list shows "Needs ingredients"/"Estimate - confirm"
  badges; Home gained an owner-only "Add ingredients to N dishes" nudge
  (`?filter=needs_ingredients` on Settings' dish list), replacing the old uses_qty nudge.
- **Step 23a — Owner can do everything.** `ALL_PERMISSIONS` in `backend/businesses/permissions.py`
  is now the single registry every permission string must come from; the Owner's set is computed
  as `ALL_PERMISSIONS`, not hand-listed, so it automatically carries `counts.status` and
  `wastage.view_own` too (it didn't before) — `GET today/`'s team-progress block, previously
  Head-chef-only, now also shows for the Owner. Manager/Head chef/Helper unchanged.
  `scripts/smoke.py`'s new `check_permission_table` fails if the Owner ever drifts from
  `ALL_PERMISSIONS`, and prints the role table.
- **Step 23b — Daily workflow: opening count, then closing count.** New `day_starts_hour` setting
  (default 5): a count's business date is now the local date of (count time minus this), computed
  once in `counts/business_day.py`, used only by counts and the `opening_late`/`closing_late`
  alerts (Step 23b's split of `count_late`) — sales/wastage/reports/purchases keep the plain
  calendar date. A closing needs an opening first unless it was missed (deadline passed, or the
  closing window already started), else 409 `opening_required`; a missed-opening closing saves with
  `missing_opening: true`. New `GET counts/today/` (`today_status.status_for`, shared with `today/`)
  exposes locked/due/late/done + `next_action`, driving a real two-row Today card on Home and
  routing `/count` straight to whichever count is next.
- **Step 23d — First-ever count: "Starting stock".** A business's first count ever (`counts/
  business_day.py`'s `has_any_count`) is always an opening, stored through the same API/rules as
  Step 23b, but never late and Save enables at 1+ item counted (the rest submit as skipped, same
  "every item addressed" server rule). `opening_late`/`closing_late` don't fire until a first count
  exists. `/count` frames it "Starting stock" with an intro card; Home gets a matching Owner-only
  nudge. Fixed a pre-existing bug found while on this: `counts/gap.py`'s gap window matched sales by
  each count's shifted `business_date` instead of its plain local calendar date, which could miss a
  late-night count's same-night sales once day_starts_hour was non-zero.
- **Step 23e — Test tiering.** `smoke.py --area <name>` (repeatable), `flow.mjs --only <scenario>`,
  `responsive_check.mjs --screen <name>` (both `--list`-able) — each runs only its own checks plus
  the minimum shared setup; default (no flag) is unchanged, full behaviour. New `npm run verify`
  (check + a smoke area), `verify:ui` (+ one flow scenario + one screen), `verify:full` (everything,
  user-run before deploys — see CLAUDE.md's tiers). Fixed a pre-existing bug: `responsive_check.mjs`'s
  `buildOwnerSession` still expected "Count stock" (Step 23d renamed it "Starting stock"). Found but
  didn't fix (pre-existing, confirmed against the untouched original, unrelated to this step): the
  full default `npm run flow` fails reproducibly in this dev environment right after landing's
  hero-link click, immediately followed by wizard's own fresh `/signup` navigation.
- **Step C1 — AI backend for menu reading and recipe suggestions.** New `ai` app: `POST
  businesses/<id>/ai/menu-scans/` (1-6 images or one PDF, processed by the `worker` service so it
  never blocks a web request — inline when `AI_FAKE`, true by default in dev/tests) and `POST
  .../ai/recipe-suggestions/` (max 15 dishes/call), both `sellitems.manage`. One swappable provider
  seam (`ai/provider/`) behind a forced tool call + pydantic schema validation, a fallback model on a
  schema-invalid result, prompt caching, and a 60s timeout; a shared `AiRecipeCache` (generic
  ingredients only, never business data) skips the API on a repeat dish name. Per-business daily caps
  (scans/pages/recipe-dishes) and a whole-deployment monthly cost cap (503 `ai_unavailable` once
  reached); `AiUsage` tracks every real call's cost, read-only in the admin. New `scripts/ai_try_menu.py`
  for trying real menus by hand; `docs/PRIVACY_NOTES.md` for the future privacy page. Found but
  didn't fix (pre-existing, confirmed against `--area alerts` alone on the untouched `alerts` app,
  unrelated to this step): `check_alerts_flow` reliably fails today (2026-10-23) with an unexpected
  `wastage_high` alert where `gap_flagged` was expected — looks like a date-boundary issue in the gap
  math, not anything this step touched.
- **Step 22a2 — Every manual dish create/edit goes through DishRecipeForm.** Onboarding's "What you
  sell" (setup/4) now opens the same `SellItemSheet`/`DishRecipeForm` as Settings instead of the old
  ingredients-free `SellItemForm` + `sell-items/bulk/` quick-add; `SellItemForm.tsx`/
  `validateSellItem.ts` deleted (no longer used anywhere). `SellItemSheet` now takes an explicit
  `business` prop rather than assuming `businesses[0]`, since onboarding's business isn't always
  that. `sell-items/` (single create) and its PATCH already required >=1 ingredient since Step 22a,
  so no backend change was needed; `sell-items/bulk/` stays ingredients-free, still used by the
  starter-pack tick list.
- **Step C1b — AI cost-maths fix, prompt tuning, no silent truncation.** Fixed a real crash
  (`ai_try_menu.py` mixed `float` into `settings.AI_PRICE_*`'s `Decimal`, which `ai/limits.py` was
  already doing correctly) and gave the fake provider realistic token counts (2,500 in/1,200 out) so
  `AiUsage.est_cost_usd`/the monthly cap behave like the real API. `ExtractedDish` gained
  `kind` (dish/addon), `note` ("has options"/"two names"), `variants`; `DishRecipeSuggestion` split
  into `ingredients` (max 7) and `minor_ingredients` (salt/pepper/water/<2g spice); confidence/prompt
  wording tuned; `temperature=0`, `RECIPE_PROMPT_VERSION` bumped (now part of `AiRecipeCache`'s
  key) to invalidate stale cache rows. A PDF menu is now read ~3 pages per call (`ai/jobs.py`'s
  `_chunk_pdf`) and merged/deduped (`schemas.merge_menu_results`); the dish cap is 400, and a
  max_tokens stop or a cap hit sets `MenuScan.result.incomplete` instead of returning a silent
  partial list — never exposed in the 10-page/10MB upload limits, which are unchanged.
- **Step C1c — Real-API call fix.** `anthropic_provider.py`'s `temperature=0` kwarg crashed every
  real call (`anthropic` 2.x's `Messages.create` dropped it; `tools`/`tool_choice`/`system`/
  `cache_control`/document+image blocks are all unaffected) — removed, no behaviour change since
  the tool-call schema already forces consistency. New `check_ai_provider_signature` (no network/
  key) in `verify --area ai` checks every real-provider kwarg against the installed SDK's
  `Messages.create` signature, so an SDK upgrade like this one fails fast next time.
- **Step C1d — one real pipeline, chunk-overflow recovery, prompt fixes.** New `ai/extraction.py`'s
  `run_menu_extraction` (chunk, call, merge, incomplete) is now used by both `ai/jobs.py` and
  `scripts/ai_try_menu.py` (previously bypassed chunking entirely, so a 10-page PDF overflowed in one
  call and returned 0 dishes); a chunk that stops at max_tokens is retried one page at a time before
  giving up, only marking `incomplete` if a single page still overflows. Confidence prompt now anchors
  0.95/0.8/below 0.75 instead of drifting to one value; variants must be names (schemas.py rejects
  price-like strings as a backstop) and empty dish fields are omitted to shrink output. Script now
  writes UTF-8 and prints chunk/cost breakdown. Proved against real menus: a 1-image menu (44 dishes,
  1 call, ~$0.009) and `_private/menus/fomomenu.pdf` (8 pages, 3 chunks, 193 dishes, no truncation,
  ~$0.052, correctly resolved "Chicken Lollipop / Drums of Heaven" to `note: "two names"` with no
  variants). Found but didn't fix (pre-existing, out of this step's scope): `ai_try_menu.py`'s recipe-
  suggestion call fails against the real API — `AI_MODEL_FALLBACK`'s configured model rejects a forced
  `tool_choice`, unrelated to menu extraction.
- **Step C1e — fallback-model call fix.** The real validation failure that triggers the fallback was
  Haiku occasionally naming a recipe dish `name` instead of the required `dish_name` for some dishes
  in a batch — a model slip the fallback retry exists for, not a prompt/schema bug (now logged, no raw
  content, by `base.run_with_fallback` when it happens). The actual crash was the fallback call itself:
  `claude-sonnet-5-5` defaults to adaptive thinking and rejects a forced `tool_choice`. New
  `anthropic_provider.tool_choice_for_model` (`_MODELS_REQUIRING_AUTO_TOOL_CHOICE`) gives that model
  `{"type": "auto"}` plus a system line forcing the tool, retried once if no `tool_use` block comes
  back; every other model keeps the forced `tool_choice`. `check_ai_provider_signature` now also
  asserts `AI_MODEL_FALLBACK` never gets a forced `tool_choice` and `AI_MODEL_MENU` still does.
  New smoke case proves a recipe suggestion that fails validation once recovers via the fallback
  model (previously only the menu-scan path had this case). Proved against real menus:
  `fomomenu.pdf` (193 dishes, no truncation, ~$0.052) with its recipe batch genuinely hitting the
  Haiku slip above and recovering on `claude-sonnet-5-5` (~$0.008); `menu1.jpeg` run a second time
  with `AI_MODEL_MENU`/`AI_MODEL_RECIPE` forced to `claude-sonnet-5-5` to prove that model works
  end-to-end as a primary, not just as a fallback.
- **Step C2a — Menu upload UI: scan/upload, analyze, review, save.** Two backend fixes first:
  `DishRecipeSuggestion.dish_name` now accepts a `name` alias (no fallback-model retry for Haiku's
  occasional slip), and `schemas.py`'s variant validator keeps a short bare number on one side of a
  slash (e.g. "Gobi Manchurian/65" — a dish style) while still stripping real prices. New
  `sectorCopy`'s `menuScanEnabled`/`menuNoun` (food + homestay types only) gates a choice screen
  ("Scan or upload" vs "Add one by one") on onboarding's "What you sell" and a new "Add from menu"
  button on Settings' sell-items screen. New `/menu-scan` route group (source: camera/gallery/PDF
  picker with client-side resize; analyzing: polls with backoff; review: editable grouped dish list,
  tick/edit/delete/add, section rename, skip-existing, incomplete-scan "add another photo"; done)
  all saving through the existing `sell-items/bulk/` endpoint (section name -> `group`). Recipes/
  ingredients and best-sellers are not in this step — see Not built yet.

- **Step F1 — Admin can delete test users and businesses.** `UserAdmin.has_delete_permission` is now
  superuser-only (never the caller's own account, never the last active superuser — enforced again in
  `delete_queryset` for the bulk "Delete selected" action, since Django only checks permission once
  for that). Deleting a user who owns a business still correctly fails on `Business.created_by`'s
  existing `PROTECT` (no raw DB error — Django's admin shows it); `get_deleted_objects` now also warns
  and points at the new `Business` admin action first. New `BusinessAdmin.delete_business_and_data`
  (superuser-only, a two-step confirm page with per-business counts) deletes a business and
  everything under it in PROTECT-safe order (Sale, WastageEntry, StockCount, Purchase, SellItem, then
  StockItem, then the Business itself — Access/OnboardingProgress/BusinessSettings/AlertCheck/
  MenuScan/AiUsage all cascade), one transaction, one `admin.business_delete` audit-log line (business
  name, owner email, counts) per business; `Business`/ledger models stay undeletable from their own
  admin pages otherwise. No model `on_delete` behaviour changed. New `verify --area admin` /
  `check_admin_delete_flow` (django.test.Client against the dev DB, no live-server HTTP needed) proves
  all of the above, including the last-superuser case via a rolled-back transaction so no real
  account is ever touched.

- **Step F2 — The business name is asked once, at sign-up.** `SignupSerializer` gained
  `business_name`; `SignupView` now creates the Business in the same transaction as the User, with
  only its name (`business_type`/`city` now `blank=True`, filled in by the wizard) — new
  `businesses/creation.py`'s `create_business` is shared with `BusinessCreateView`. Onboarding step 1
  shows the name as a line with a Change link (inline edit); `BusinessForm`'s name field only renders
  for the true fallback case (older account, invite, or a business that somehow has no name yet).
  Always a PATCH on the existing business, never a second create. Fixed a pre-existing race while on
  this: `setup/1.tsx`'s draft state hydrated from `existing` only once at mount, which could capture
  nothing if a post-login redirect landed before AuthContext's businesses fetch had committed —
  invisible before (every field was blank right after signup); now re-hydrates via `useLayoutEffect`.

- **Step C2c — Worker container fix + stuck-scan handling.** Production bug: `backend/entrypoint.sh`
  ignored any command it was given and always ran gunicorn, so the `worker` service (meant to run
  `manage.py run_ai_jobs`) actually ran a second gunicorn and never processed scans — they stayed
  `queued` forever. Fixed: `exec "$@"` when a command is passed, gunicorn only as the no-args default;
  `RUN_SETUP=0` on the worker (docker-compose.prod.yml) skips migrate/load_pincodes/collectstatic
  there, and it now `depends_on` the backend's healthcheck too, so only one container ever migrates.
  `run_ai_jobs`: a per-job try/except marks a crashing job failed (`worker_error`) instead of killing
  the loop, a heartbeat log every 5 minutes, start/per-job result logging (ids/status only, never menu
  content), and the stuck-`reading`-job recovery window is now 10 minutes (was 2). New Django admin
  (superuser-only, read-only): `MenuScanAdmin` (id/business/status/created/finished/error/page_count);
  `AiUsageAdmin` gained the same superuser gate. Mobile: `analyzing.tsx` now shows "This is taking
  longer than usual" with Try again/Add one by one once a scan is still queued/reading past
  `STUCK_AFTER_MS` (3 minutes, `EXPO_PUBLIC_MENU_SCAN_STUCK_AFTER_MS`-overridable for tests) — polling
  continues underneath in case it finishes right after. New `ai/views.py` AI_FAKE-only
  `FORCE_NEVER_FINISH` marker (a scan that stays queued forever) backs a new stuck-scan check appended
  to `flow.mjs`'s `menu-scan` scenario; new `npm run check:entrypoint` unit-tests the entrypoint fix
  without Docker. Verified by `npm run check` + `npm run verify -- --area ai` (both green) and the new
  `check:entrypoint` unit test — **the `verify:ui` stuck-scan browser run was started but stopped
  before it finished** (it waits out a real ~3-minute timeout against the shared dev server) and was
  never confirmed end to end; `analyzing.tsx`'s stuck-UI branch and the `flow.mjs`/fixture-PDF check
  are unverified in a live browser as of this step. Found but didn't fix (pre-existing, confirmed on
  untouched `main` too, unrelated to this step): `check_ai_flow`'s own `owner_access` user hits the
  3-business cap partway through (`AI Incomplete Biz` create gets 422 `BUSINESS_LIMIT_REACHED`) — the
  smoke test itself creates one business too many for one user.

- **Step F3 — Show/hide on every password and PIN field.** `PasswordField.tsx` gained `mode`
  (`'password'`/`'pin'`) and `resetSignal` props, replacing three separate inline PIN show/hide
  copies (`TeamAddSheet`, `ChangeRoleSheet`, `ResetSecretSheet` now all use it); PIN mode drops the
  strength meter and forces the numeric keypad. The owner login screen's password field had no
  show/hide at all before this step — now uses the same component (`showStrength={false}`, since an
  existing password isn't being chosen). `resetSignal` (a sheet's `visible` prop, or a new per-screen
  submit counter on `login.tsx`/`signup.tsx`) re-hides the value once the sheet closes/reopens or the
  form is submitted. No backend change; signup has no confirm-password field to extend.

- **Step F4 — Configurable bulk-row cap.** `stock-items/bulk/`/`sell-items/bulk/`'s per-request row
  cap was a hardcoded 100 (`stock/views.py`'s old `MAX_BULK_ROWS`); a scanned menu with more dishes
  than that failed "Add N dishes" with a generic error, since the review screen didn't recognise
  `TOO_MANY_ROWS`. Now `settings.MAX_BULK_ROWS` (env `MAX_BULK_ROWS`, default 500), and
  `TooManyRows`'s message names the actual configured cap instead of a hardcoded "100". No frontend
  change — the review screen still has no batching or a specific message for this error, just a
  much higher ceiling before it's hit.

- **Step U1b-1 — Base units, backend foundation (docs/UNIT_REDESIGN.md).** Every weight stock item's
  base unit is now `g`, every volume item's `ml` — new `stock/units.py` (`UnitFamily`,
  `unit_family()`), `StockItem.unit_family` (locked by history same as `unit`, once there's a
  purchase/count/wastage/sale row — broadened from the old purchase/count-only check) and
  `pack_size_base_qty` (never locked). `usual_price`/`PurchaseLine.unit_price`/`WastageEntry.
  unit_cost_at_entry` widened 2dp->4dp (12 digits) — a per-base-unit price now, not per-kg/L.
  Migrations `0006_base_units`/`0007_backfill_base_units` rebased all 766 dev stock items (533 kg,
  199 L) and their purchase/count/wastage/ingredient rows, reversibly; tested on a DB copy first,
  proven against the real Milk example (22,500 ml used, 2,500 ml gap, ₹160, 12.5%) and a kg-bought/
  gram-used item via `manage.py verify_u1b1_base_units`, both through the real `counts/gap.py` with
  zero logic changes there, confirming the audit's "gap maths is unit-agnostic" finding. `ai/
  matching.py`'s `bottle` moved out of the `ml` family (Decision 5: a pack-of-pieces count unit now).
  `kg`/`L`/`tonne` still work as *creatable* `StockItem.unit` values for now — U1b-2 narrows entry
  and adds the shared conversion screens; no app screen was touched this step. See that migration's
  docstring for its one known gap: a tonne-origin item (none in dev data) would reverse as kg-scale.
- **Step U1b-2 — Entry units and shared conversion, backend only.** Purchases, counts, wastage and
  recipe-ingredient rows now accept an optional entry unit (kg/L/tonne, or a packet/bag/tin/bottle/
  box backed by the new `StockItem.pack_size_base_qty`) and convert to the item's base unit
  server-side (`stock/units.py`'s `convert_entry_quantity`/`convert_entry_price`); stock-item
  create/edit resolves a chosen unit into its base + `unit_family` automatically, and the unit lock
  now keys off the derived family. Read responses add a rolled-up `display_quantity`/`display_unit`
  and an owner-facing price per kg/L. **U1b-2 backend done; frontend module, sector unit lists and
  screens remain (U1b-3). Do not deploy until U1b-3.**
- **Step U1b-3a — Shared unit module + Record purchase.** `mobile/src/units.ts` promotes the old
  ingredient-only `unitConversion.ts` into one shared mirror of `backend/stock/units.py`, checked by
  a new `check:units-parity` script (transpiles units.ts, diffs it against the real backend tables,
  plus the 3,200 g/999 g/1,000 ml rounding cases). New `forms/QuantityInput.tsx` (amount + unit
  chips from `entryUnitsFor`, a missing-pack-size hint) is wired into `RecordPurchaseSheet` only;
  `stock/[id].tsx` and the stock bulk-create/list serializer now show `*_price_per_major_unit`
  (kg/L), not the raw per-g/ml figure.
- **Step U1b-3b-1 — Remaining entry screens.** Count entry (`app/count.tsx`, opening/closing/
  starting stock), `RecordWastageSheet` and `DishRecipeForm` all now use `QuantityInput` + send
  `entry_unit`; `counts/form/` adds `unit_family`/`pack_size_base_qty` for this. Old ingredient-only
  `forms/unitConversion.ts` deleted. `StockItemForm` groups unit chips into Weight/Volume/Count, adds
  a pack-size field, and shows a lock message (`StockItem.unit_locked`, new) once an item has
  history. **U1b-3b-2 still owes**: stock/sell lists, reports, home, alerts and admin screens'
  display-unit formatting.
- **Step U1b-3b-2 (backend half only) — Report/alert/admin display-unit fixes.** Fixed the real bug:
  `reports/service.py`'s wastage trend grouped quantities by each stock item's own raw unit (`g`/`ml`
  post-migration, previously read as the old `kg`/`L`), so mixed-family totals and `verify --area
  reports`'s own assertion (still checking for a `"L"` key) were wrong; now `quantity_by_family`
  (`stock/units.py`'s new `report_group_key`/`display_quantities`) sums weight/volume into one
  fungible bucket each with `base_qty`/`display_qty`/`display_unit`, every other unit its own bucket.
  `alerts/service.py`'s wastage_high/gap_flagged/expiry_soon detail text and `numbers` and
  price_rise's prices now go through `display_quantity(ies)`/`display_price_per_major_unit` instead
  of raw base numbers/per-gram prices; same for `reports/service.py`'s used_vs_expected/biggest_gaps.
  Django admin (`StockItemAdmin`, `PurchaseLineInline`, `WastageEntryAdmin`, `CountLineInline`) gained
  display-converted columns alongside the raw stored ones. New `scripts/smoke.py` check builds
  wastage entries with `entry_unit: "kg"`/`"L"` and asserts the report's family rollup (2 kg -> 2,000
  g, 1.2 L -> 1,200 ml). **Still owed** (not done this step, ran out of time): Part 2's mobile screen
  sweep — stock/sell/dish lists, purchases/wastage/count history, counts review (backend
  `counts/gap.py`'s own `CountDetailView` output is also still raw base units, untouched), home cards,
  the AI review screens, Settings/team screens. See the branch's own commit for exact scope.

- **Step O1 — Onboarding fork: quick setup from a menu scan, or DIY.** New `setup/fork.tsx`, "How
  do you want to set up?", shown once right after step 1 for menuScanEnabled sectors only (new
  `Business.onboarding_path` — `""`/`quick`/`diy` — persists the choice so a reload or "Save and
  continue later" resumes at the fork). Quick launches `/menu-scan` directly, before brand/buy are
  visited, then continues brand→buy (now showing how many scanned dishes still need ingredients)→
  sell (already populated); DIY continues to brand exactly as before. The old scan-vs-manual choice
  card on `setup/4.tsx` (step 4) is gone — that screen always opens on the list+form now. No other
  step was reordered or renumbered; existing businesses already past step 2 with no path saved
  default to DIY silently. `flow.mjs`'s `onboarding-menu`/`onboarding-diy` scenarios (`npm run flow
  -- --only <name>`) cover both paths; `menu-scan-stuck` is the old Step C2c stuck-scan case, split
  out since it's unrelated to this fork (kept, still unconfirmed in a live browser as of Step C2c).
- **Step U2b1b1/b2 — Bases engine (docs/BASES_PLAN.md).** b1: `gap.py`'s all-or-nothing
  `not_confirmed` check replaced by a coverage split (confirmed vs unconfirmed expected usage;
  `>=70%` real/alert-eligible with widened tolerance, `40-70%` indicative, `<40%`
  `low_recipe_coverage`); Home's `recipe_coverage_pct` added (revenue-weighted, separate from the
  per-ingredient figure). b2: new `stock.Base`/`BaseIngredient`/`SellItemBase` models (migration
  0008, additive, no backfill) and `stock/base_expansion.py`'s one-level expansion — a dish's
  per-portion stock usage now folds in both its direct `SellItemIngredient` rows and, via any base
  it uses, that base's `BaseIngredient` formula scaled by `SellItemBase.quantity`; both sum if a
  stock item is reached both ways. Wired into `gap.py`'s coverage split in place of the old direct-
  only query. No API/CRUD or screens yet — a base can only be created via the ORM/admin shell so
  far; next is Step 3 (low-stock thresholds/alerts) per the plan's sub-step split.
- **Step 41b1b3a — Low-stock thresholds, estimate, alert and shopping list (backend only, no
  screens, docs/BASES_PLAN.md sec 8.3).** `StockItem` gained `low_stock_category` (perishable=1/
  fresh_semi=3/dry_staples=7/packaging_cleaning=14 days of cover, new rows default from `goes_off`),
  `low_stock_days_override`, `low_stock_fixed_qty` (migrations 0009-0010, additive + a `goes_off`
  backfill). New `stock/low_stock.py`: `estimated_stock_now` (last count + bought − wasted −
  confirmed-recipe expected usage since, `None` if never counted), `effective_threshold` (fixed
  qty vs days-of-cover × 14-day average usage), `low_stock_rows` (shared by the alert and the list).
  New `low_stock` alert type (daily-keyed, no money in its text) and `GET businesses/<id>/stock/
  low-stock/` (shopping list, `suggested_order_qty`, grouped by stock group; shortfall ₹ shown only
  to a caller who can already see money). New permissions `stockitems.thresholds_manage` (Owner/
  Manager) and `stock.low_stock_view` (+ Head chef); the existing stock-item PATCH now checks
  threshold fields against the former, every other field against `stockitems.manage` as before.
  New `check_low_stock_flow` (areas `stock`/`alerts`).
- **Step 42b1c1 — Bases API and screens: manual create, edit, map to dishes (docs/BASES_PLAN.md
  secs 1-2, 5, 8.4).** `Base` gained `batch_yield_qty` (default 1,000; migration 0011) — every
  ingredient quantity is defined against this batch size, not a hardcoded 1,000 (`base_expansion.py`
  now divides by it). New `GET/POST businesses/<id>/bases/`, `GET/PATCH/DELETE .../bases/<id>/`
  (full-replace ingredients on edit, like a dish's own), `PUT .../bases/<id>/used-in/` (a base's own
  full-replace dish-link list) — all Owner-only (`sellitems.manage`). Deleting an in-use base is
  refused (409, naming the dishes) unless `confirm_unlink: true`, which unlinks it from every dish
  first. `SellItemCreateSerializer`/`UpdateSerializer` gained an optional `bases: [{base, quantity}]`
  array alongside `ingredients` — a dish needs at least one real line between the two now, not
  ingredients alone. New Settings screen "Things you make in batches" (list + add/edit sheet,
  `BaseRecipeForm`/`BaseSheet`) and a "use a batch recipe" section in `DishRecipeForm` (wired into
  Settings' "What you sell" only — `setup/4.tsx`'s onboarding dish form doesn't pass `bases` yet,
  so its picker stays hidden there). New `check_bases_flow` (area `stock`) proves the Chicken Curry
  example (1,000 g batch, 200 g/portion, 10 sold → 900 g onion expected) through a real count.
  **Still owed**: the base's own "Used in" picker screen (API exists, no UI yet — dish-side linking
  covers the core flow), the dish view's raw-equivalent note ("uses about 90 g onion through the
  base"), recipe-card base-line styling beyond the edit form, `setup/4.tsx` wiring, and the
  `verify:ui` browser flow (no `flow.mjs` scenario was added this step — ran out of time).
- **Step 43b1c2a — Low-stock screens, the estimate fix, bases' own `verify:ui` flow still owed
  (docs/BASES_PLAN.md secs 3-5, 8.3).** `stock/low_stock.py`'s `estimated_stock_now` now subtracts
  ALL recipes' expected usage (confirmed and unconfirmed/suggested), not confirmed-only — ignoring
  an unreviewed recipe's usage overstated available stock, the unsafe direction; a new
  `partly_unconfirmed` flag (not hidden) says when some of that subtraction rests on an unconfirmed
  recipe, threaded through `low_stock_rows`, `LowStockListView` and the `low_stock` alert's `detail`/
  `numbers`. Loss-alert coverage rules (`counts/gap.py`) are unchanged — only the stock estimate
  itself. New smoke case (`check_low_stock_flow`) proves it with a direct-SQL `recipe_status`
  flip (same pattern `_ai_sql_write` already uses — no API path to `unconfirmed` exists yet).
  New mobile: `StockItemForm`'s low-stock threshold section (category chips, optional override
  days, optional fixed minimum via `QuantityInput`, an "Alert when..." plain-words summary),
  visible only with `canManageThresholds`; `StockItemSheet` gained a `mode: 'thresholds'` that
  renders the section alone and PATCHes only those three fields — a Manager's own entry point
  (`stock/[id].tsx`'s new "Low-stock alert" button), separate from the Owner's full "Edit item"
  sheet (which now folds the section in too). New `GET stock/low-stock/` screen
  (`app/stock/low-stock.tsx`, grouped list, estimate/threshold/suggested order, shortfall ₹ only
  when the row carries it, "based on suggested recipes" note when `partly_unconfirmed`) reachable
  from the Stock list (Owner/Manager) and a Home nudge card (Owner/Manager via `OwnerHome`, Head
  chef via `TodayHome` — Helper has no `stock.low_stock_view` so sees neither). `low_stock` was
  missing from the mobile `AlertType` union and the Alerts screen's filter chips/icon/number-row
  mapping entirely (Step 41b1b3a only built the backend half) — added. **Still owed**: the
  `verify:ui` browser flow for both this step's screens and Step 42b1c1's bases screens (bases
  list, base sheet, dish form's base picker) — no `flow.mjs` scenario or `responsive_check.mjs`
  screen entries exist for either yet; ran out of time. Also still owed from Step 42b1c1: the
  base's own "Used in" screen, the dish raw-equivalent note, `setup/4.tsx`'s bases wiring. Also
  still owed from this step: closing-count leftover entry, Home's revenue-weighted coverage
  banner (docs/BASES_PLAN.md secs 5, 8.4's Screens sub-step).

- **Step 44v1 — Browser verification for bases and low-stock (390px + responsive audit), no new
  features.** Proved Step 42b1c1's bases screens and Step 43b1c2a's low-stock screens in a real
  browser for the first time (`flow.mjs`'s new `bases` and `low-stock` scenarios, both solo), and
  found/fixed three real bugs along the way — none of them in this step's own screens:
  - **`permissions.py`'s Manager role was missing `stock.low_stock_view`**, even though this table
    and `MAP.md` both already documented Manager as `yes` — Manager could set thresholds
    (`stockitems.thresholds_manage`) but the "Low stock & shopping list" link never rendered for
    them on Stock, and the list/Home-nudge entry points were unreachable. Added the permission
    string to `_LOWER_ROLE_PERMISSIONS[MANAGER]`; `smoke.py --area permissions`'s role-table dump
    now shows it.
  - **`flow.mjs`'s wizard scenario shadowed its own `helperMobile`/`helperPin`/`headChefMobile`/
    `headChefPin`/`managerMobile`/`managerPassword` variables** — declared with `const` inside the
    wizard's own block instead of assigning the outer `let`s (unlike `name`/`mobile`/`password`,
    which correctly assign without `const` just above them), so every later chain scenario that
    logs in as the Helper/Head chef/Manager (`helper-today`, `headchef-today`, `manager-home`, and
    everything chained after them) crashed logging in with `undefined` credentials. This had
    nothing to do with bases or low-stock — found only because this step needed those same role
    credentials for its own low-stock-permissions check, and `--only manager-home` reliably
    crashed before the fix.
  - **The signup rate limiter tripped repeatedly during this step's repeated local runs** (bases
    and low-stock both sign up a fresh Owner, low-stock adds 3 more team accounts). Made
    `signup_per_ip` configurable (`RATE_LIMIT_SIGNUP_PER_IP` env var, default unchanged at 32/hour)
    and set it high when starting the backend for this kind of verification session — e.g.
    `$env:RATE_LIMIT_SIGNUP_PER_IP=1000; npm run dev` (PowerShell) before a `flow`/`verify:ui` run
    that signs up more than a handful of accounts on one dev IP.
  Flows run: bases (create "Onion-tomato masala" — onion 450g/tomato 400g/oil 90ml/cashew 40g/
  garam masala 20g against the cloud_kitchen starter catalogue's own kg/L items, which store in
  base units regardless of entry unit — reopen it, use it in a dish at 200g/portion alongside one
  direct ingredient, reopen the dish and see both lines); low-stock (Owner sets a 3-day override
  and a 5kg fixed minimum on Rice, counts 3kg, sees the `low_stock` alert and the shopping list
  from both Stock and the Home nudge; Manager sees the list and uses the narrow "Low-stock alert"
  sheet; Head chef reaches the list via the Home nudge only, with no shortfall value and no
  `/stock` access; Helper has no entry point anywhere); `onboarding-diy` and `onboarding-menu`
  regression, both still green. **Not done**: the 320-1280px responsive audit for the 5 screens
  this step was asked to cover (bases list, base sheet, dish form's base picker, the threshold
  section, the low-stock screen) — ran out of time; no `responsive_check.mjs --screen` entries
  were added. **Also found, not fixed (needs its own step, not a small fix)**: deleting a base
  while it's in use has no UI at all — `bases.tsx`/`BaseSheet.tsx` never call `DELETE
  .../bases/<id>/`, even though the backend's 409-with-`confirm_unlink` refusal and the
  `deleteButton`/`deleteConfirmTitle`/`deleteInUseMessage`/`deleteConfirmButton` copy in
  `strings.ts` already exist for it.

- **Step 45b1c2b — Base delete UI, the base's own Used-in screen, the dish-form raw-equivalent
  note, Home's coverage banner, and the 320-1280px responsive audit Step 44v1 owed.** `BaseSheet`
  gained a Delete button (Owner-only, in-use or not) wired to the existing `DELETE
  .../bases/<id>/` 409-then-`confirm_unlink` endpoint, with a "Used in N dishes. Deleting removes
  it from them." confirm dialog when in use. New `settings/bases/[id].tsx` ("Used in") lists the
  dishes using a base (search/add via `PUT .../bases/<id>/used-in/`, edit grams, remove a dish);
  `settings/bases.tsx` moved to `settings/bases/index.tsx` to make room for it. `DishRecipeForm`
  shows a raw-equivalent note under each base line ("This dish uses about 90 g Onion, 80 g
  Tomato, ... through the base"), computed client-side from the base's own formula (mirrors
  `base_expansion.py`'s contribution math, nothing sent to the server). Home gained a "Recipes
  cover X% of your sales" banner (Owner/Manager via `reports.view`, reusing
  `reports/summary/?period=30d`'s existing `recipe_coverage_pct` — no new backend endpoint),
  tapping it opens `/settings/sell?filter=needs_ingredients` (not revenue-sorted — reusing the
  existing needs-ingredients filter was judged enough for this step rather than adding a new
  sorted-by-revenue read). `flow.mjs`'s `bases` scenario extended to cover delete-while-in-use,
  the Used-in screen, the raw-equivalent note and the coverage banner; `responsive_check.mjs`
  gained `settings-bases`, `base-used-in`, `stock-low-stock` routes and a `sheet-edit-base` sheet,
  plus `buildOwnerSession` now also creates a base, links it to a dish, and sets a stock item's
  low-stock threshold — all 6 screens this step covers (bases list, base sheet, base Used-in,
  dish form's base picker via `sheet-edit-sell-item`, the threshold section via
  `sheet-edit-stock-item`, `stock-low-stock`) pass clean at every width. **Still owed**:
  `setup/4.tsx`'s own dish form still doesn't pass `bases` (pre-existing gap, not this step's
  scope); the coverage banner's destination list isn't sorted by revenue.

- **Step EK-1 — Knowledge library + base-discovery skill (backend only, docs/BASES_PLAN.md).** New
  `backend/ai/knowledge/` (plain `<sector>.json` files — restaurant_cafe ships 8 base templates,
  portion defaults, and rules; any other sector falls back to an empty-but-same-shape library) and
  `ai/base_discovery.py`: `expand_dish_options` (deterministic, e.g. "Chicken (Manchurian/Chilli)" ->
  2 dishes) and `discover_bases` (library-first model call via new `AI_MODEL_KITCHEN`, cached by
  sector + dish-name-set hash, deterministic `sanity_check` afterward drops a base under the min-
  dishes rule and flags — never silently fixes — an off formula or implausible per-portion amount).
  New `scripts/ai_try_kitchen.py`, proved against real menus: Kavan found 5 bases (onion-tomato
  masala 8 dishes, Indo-Chinese sauce 10, frying batter 14, cooked rice 8, atta dough 6; correctly
  no makhani or ginger-garlic); FOMO (199 dishes after expansion) found 6, including makhani (4
  dishes — genuinely used there, unlike Kavan). The first prompt draft under-enumerated (found only
  1 base on a 100+ dish menu) until told explicitly to go through every template rather than stop
  after the first good match; also bumped `_MAX_TOKENS_KITCHEN` 4000->8000 after it silently returned
  zero bases (a max_tokens truncation that still parsed as valid-but-empty — the result's `usage.
  truncated` flag now surfaces this to the caller, same gap scanning's `incomplete` flag covers for
  menu reading). No endpoint/screen yet — EK-2/EK-3 own the confirm-and-create-real-Base flow.

- **Step EK-2 — Grouped-line extraction fix + classify-then-map (backend only, docs/BASES_PLAN.md).**
  Fixed a real pre-existing bug first: `check_ai_flow`'s own `owner_access` user was created via
  `signup_and_login` (which, Step F2, already auto-creates 1 business) and then explicitly created 3
  more, hitting the 3-business-per-user cap on the 4th — `npm run verify -- --area ai` had been
  unable to complete since Step C1 shipped. Fixed by reusing `chunk_business_id` where its own daily
  scan cap allowed, and a fresh signup (its own untouched business/cap) for the two checks that
  didn't fit. `schemas.ExtractedDish` gained `variant_position`("prefix"/"suffix")/`variant_prices` —
  the menu prompt now also recognises a heading-plus-separate-choices group (e.g. a "MANCHURIAN"
  heading over "Gobi/Paneer/Babycorn/Mushroom", or two price columns like a Veg/Chicken soup), never
  just a bare heading dish; `base_discovery.expand_dish_options` rewritten to build real dish names
  (and per-variant prices) from these fields instead of re-parsing the name string with its own regex.
  Replaced EK-1's free-form "ask the model for the whole base mapping" with classify-then-map: new
  `classification.py`'s `classify_dishes` has the model pick only a type (from `knowledge/
  dish_types.json`'s fixed taxonomy) + a family tag per dish, batched ~60/call and cached per dish
  name (`AiDishTypeCache`, reusable across menus/businesses in the same sector, unlike the per-menu
  `AiKitchenBaseCache`); `base_discovery.map_bases_from_classification` then looks the base and grams/
  ml per portion up deterministically from the sector's new `type_rules` (`family_overrides` for
  e.g. mutton 220g vs the type's 200g default) — the model never invents a formula or quantity anymore.
  `sanity_check`'s formula check now only flags OVER-yield (water removed from every template formula,
  noted in each template's own `notes` instead, so under-filling is expected, not an error).
  `used_by` rows carry a `family` tag so the owner can act on "all N Manchurian-type dishes" as a
  group (flagged as a simplification vs. true nested grouping — ran out of time for that). Real-run
  results (`scripts/ai_try_kitchen.py`, ~$0.16 total for both menus this step): FOMO (192 dishes, no
  bare-heading names) hit its sauce-base (38 vs ≥28 target) and batter (37 vs ≥28) targets and got
  fried rice right at 280g vs plain rice at 250g, but kept a 3rd makhani dish (Malai Paneer) the task
  expected classified elsewhere — only 2 genuine butter-style dishes, not 3. **Kavan missed its
  targets**: extraction returned 100 dishes (target ≥130, down from EK-1's 102-103) and — despite the
  new prompt and schema support, proved working via smoke tests and on FOMO — this real run still
  returned bare "Manchurian"/"Chilli"/"Pepper" dishes with no heading/variants structure at all
  (sauce base 18 vs ≥25 target, batter 24 vs ≥30), suggesting the model didn't recognise that
  specific menu's group layout rather than a schema/code bug. EK-3 should retry Kavan a few times to
  see if this is call-to-call variance or a layout the prompt genuinely doesn't cover, and decide
  whether a nested used_by grouping (vs. the flat `family` tag) is worth doing before the confirm
  screen.

- **Step EK-2d — A dish can use two bases (batter + sauce).** A dish got exactly one type before,
  so Chicken Chilli (battered AND sauce-tossed) could only map to batter OR sauce — the model's own
  pick swung wildly run to run (Kavan batter 14-20, FOMO batter 11-15/sauce 44-54, see EK-2c below).
  `DishClassification` gained an optional model-reported `secondary_type`; new deterministic
  `restaurant_cafe.json.rules.two_base_starter_rule` + `base_discovery._secondary_types_for` ADD
  whichever of fried_starter_dry/fried_starter_tossed isn't already the primary type to a dish naming
  both a protein/veg (chicken/fish/prawn/paneer/gobi/mushroom/baby corn) and a frying style (chilli/
  manchurian/65/pepper/lollipop/wings/finger/pakoda/fry) — model-independent, so run-to-run variance
  on this split can't starve either base; never touches a dish whose primary type already has no base
  (fries/nuts/mutton-fry/tandoori/soups/Thai unaffected). `map_bases_from_classification`'s new
  `add_mapping` dedups so a dish is never double-listed within the same base. New golden smoke case:
  Chicken Chilli/Gobi Manchurian/Prawn Pepper map to both batter and sauce; fries/soup/Thai curry map
  to neither. Real-run proof (`scripts/ai_try_kitchen.py`, 1 run each, ~$0.20 total): Kavan batter 40/
  sauce 45 (target 28-45/28-55 ✓), FOMO batter 41/sauce 54 (✓, right at the sauce ceiling), 0
  duplicates and 0 bare headings both menus, no fries/soup/Thai dish in any base either menu.
- **Step EK-3 — Recipe composer + ingredient resolver (backend only, docs/BASES_PLAN.md).** New
  `ai/recipe_composer.py`: `pick_best_sellers` (library-keyword-ranked shortlist, one AI call,
  deterministic category spread from each dish's own classify_dishes type, gaps filled from the
  ranked shortlist if the model under-picks); `build_families`/`compose_family_recipes` (one AI call
  per family of dishes sharing a recipe shape, capped at 25/menu — `_merge_small_families` exhausts
  same-`type` merges before ever merging across types; base grams/ml per portion are looked up
  deterministically, never asked of the model; a family recipe never repeats its base's own
  ingredients; an implausible quantity falls back to a flat default, flagged in `corrections`); new
  `AiFamilyRecipeCache` (per sector + family-members-hash, like `AiKitchenBaseCache`). `resolve_
  ingredients` merges near-duplicate names (Onion/Onions/Onion Chopped), matches the business's own
  stock items (fuzzy), and proposes new ones with a unit family and low-stock category guess, each
  carrying `used_in`. `suggest_setup(dishes, sector, business=None, menu_scan=None)` is the one
  orchestrator, optionally saving onto `MenuScan.result["setup"]`; writes nothing to StockItem/
  SellItem/Base — EK-4 owns applying it. `scripts/ai_try_kitchen.py --setup` real-run proof (2 runs
  each after fixing a same-type-merge bug found on the first Kavan run): Kavan 10 best sellers/5
  categories, 25 families, 93 ingredients (target ≤90, missed by 3), ~Rs 7.66; FOMO 10/5 categories,
  25 families, 89 ingredients, ~Rs 8.22 — both well under the Rs 15/menu cost target.
- **Step EK-2c — Remove duplicate expansion, fix names/splits, refine types.** Two real bugs fixed:
  (1) the first pass's own inline-variant expansion and the dedicated group pass could both expand
  the same heading, producing duplicates/garbled names ("Gobi Manchurian/65 65") — `apply_groups` is
  now the single source of truth (drops the first pass's matching expansion, drops a leftover bare
  choice-word fragment from the same table like "Veg" beside "Fried Rice Veg", then `dedup_dishes`
  merges anything still duplicated by word order/casing); `expand_dish_options` drops a self-duplicate
  variant. (2) The group pass's prefix/suffix label was unreliable (wrong word order) — it now returns
  each group's own final dish names directly, letting it enumerate a two-axis table ("Fried Rice/
  Noodles" x "Veg/Egg/Chicken/Mixed") as 8 real dishes in one pass. New no-base types
  (`plain_fried_snack`/`dry_masala_fry`/`gravy_thai`/`butter_garlic`/`bread_maida`) plus
  `restaurant_cafe.json`'s `keyword_type_overrides`, applied deterministically after classification
  so the model can't misplace malai/naan-kulcha/Thai-curry/butter-garlic/fries/mutton-fry dishes.
  Real-run proof (`scripts/ai_try_kitchen.py`, 2 runs each, ~$0.36 total): Kavan 140/140 dishes
  (target 125-145 ✓), FOMO 207/205 (target 195-215 ✓), 0 duplicates and 0 bare headings every run,
  no makhani base either menu, Thai curries confirmed off the Indian curry base on FOMO (it has no
  naan/kulcha/fries dishes to exercise those rules — covered by new smoke fixtures instead). **Missed
  target, not fixed**: sauce-base/batter split — Kavan run 1 sauce 38/batter 14, run 2 (after
  retuning `CLASSIFY_SYSTEM_PROMPT`'s wet/dry wording) sauce 31/batter 20; FOMO run 1 sauce 54/
  batter 11, run 2 sauce 44/batter 15 — target was 28-38 each. Both of this step's two allowed design
  attempts went into this; the model keeps funnelling most Indo-Chinese starters into the sauce-coated
  type over the dry one even after the prompt clarified the distinction, which prior steps (EK-2/
  EK-2b) also saw swing wildly run to run on the same menu — likely inherent model variance on this
  specific split, not a code bug, but not confirmed. Next step should try a few more real runs before
  touching the prompt again, or accept the split as a soft target.
- **Step EK-2b — Grouped-line extraction works on designed menus (Kavan).** Attempt A (of the task's
  two allowed): a dedicated second pass (`extract_menu_groups`/`GROUP_SYSTEM_PROMPT`, new
  `ai/schemas.ExtractedGroup`) re-reads the same file(s), focused only on heading-plus-choices
  groups — fixes the real failure: a designed, multi-column menu (headings/choices/prices on separate
  lines) still left a bare "Manchurian"-style dish with no variants from the combined EK-2 pass alone.
  New `base_discovery.apply_groups(dishes, groups)` drops that bare leftover and adds the real
  combined dish(es) via the existing `expand_dish_options`; wired into `extraction.
  run_menu_extraction` itself (one extra AiUsage row per page-chunk — `check_ai_flow`'s chunk/retry
  call-count assertions updated to match, new `FORCE_BARE_GROUP` smoke case proves `apply_groups`).
  Real-run results (`scripts/ai_try_kitchen.py`): Kavan, 3 runs — 168/172/169 dishes (target >=125),
  0 bare heading dishes every run, sauce base 59 dishes/batter 41 dishes (both well past the >=25/
  >=30 target). FOMO regression (1 run): 225 dishes, 0 bare headings, sauce 43/batter 42 (both past
  the >=28 target); makhani still maps 3 dishes (target <=2) — Malai Paneer is the extra one, the
  same pre-existing classifier quirk EK-2 already found ("malai" groups it with butter-chicken/
  paneer-butter-masala under `gravy_makhani`), unrelated to and unchanged by this step. Total real-run
  cost ~$0.24 across all 4 runs. `npm run verify -- --area ai`'s own "python" isn't the project venv
  in this shell — ran `.venv/Scripts/python.exe scripts/smoke.py --area ai` directly instead
  (pre-existing environment quirk, confirmed unrelated to this step).

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
| `stockitems.thresholds_manage` | yes | yes | no | no |
| `stock.low_stock_view` | yes | yes | yes | no |
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
- **AI/scan recipe estimation — guided ingredients flow.** Step C2a built the menu upload/review/
  save screens (dishes only, no ingredients — `recipe_status: none`). `RecipeStatus.UNCONFIRMED` and
  `DishRecipeForm`'s `stepLabel`/`onSkip` card-flow props exist as extension points but nothing
  creates or drives the recipe-suggestions call or a guided per-dish ingredients flow yet — Step C2b,
  which also owns best-sellers.
