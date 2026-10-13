# Repo map

One line per item. Current as of Step 12. Backend API prefix on every endpoint below: `/api/v1/`.

## Backend apps (backend/)

- `accounts/` — signup, login, refresh, logout, /me; models.py (User), serializers.py, otp.py (OTP, unused by UI yet), ratelimit.py (IP/mobile rate limits), validators.py (PIN/password rules), views.py, urls.py
- `audit/` — one audit-log row per write; models.py (AuditLog), log.py (log_action helper), no endpoints
- `businesses/` — business CRUD, onboarding, team, settings, permissions; models.py (Business, Access, AccessRole), views.py, team.py, business_settings.py, permissions.py (the role→permission table), access.py (access_or_403/owner_access_or_403), colour.py (brand-colour contrast), serializers.py, urls.py
- `config/` — Django project config; settings.py, urls.py (root router), exceptions.py (DRF error-shape handler), views.py (health), wsgi.py
- `counts/` — blind stock counts, today status, count review, reminders; models.py (StockCount, CountLine), views.py, serializers.py, config.py (unusual-value guard constants), exceptions.py, urls.py
- `purchases/` — purchase CRUD, suppliers; models.py (Purchase, PurchaseLine), views.py, serializers.py, exceptions.py, urls.py
- `stock/` — stock items, sell items; models.py (StockItem, SellItem), views.py, serializers.py, exceptions.py, urls.py
- `wastage/` — wastage entries; models.py (WastageEntry), views.py, serializers.py, urls.py

## Endpoints by URL (backend/*/urls.py, all under /api/v1/)

- `GET health/` — config/views.py health — liveness check
- `POST auth/signup/` — accounts SignupView — create account (honeypot + rate limit)
- `POST auth/login/` — accounts LoginView — mobile+secret (password or PIN) → access/refresh tokens
- `POST auth/refresh/` — simplejwt TokenRefreshView — rotate access/refresh
- `POST auth/logout/` — accounts LogoutView — blacklist refresh token
- `GET me/` — accounts MeView — signed-in user + their businesses/permissions
- `POST businesses/` — BusinessCreateView — create a business (Owner)
- `PATCH businesses/<id>/` — BusinessUpdateView — name/colour/logo/checklist fields
- `POST businesses/<id>/logo/` — BusinessLogoView — upload logo image
- `GET businesses/<id>/onboarding/` — OnboardingListView — wizard step states
- `PATCH businesses/<id>/onboarding/<step>/` — OnboardingStepView — save or skip one step
- `POST businesses/<id>/onboarding/complete/` — OnboardingCompleteView — mark wizard done
- `GET/POST businesses/<id>/team/` — TeamListCreateView — list team, add a member
- `PATCH/DELETE businesses/<id>/team/<access_id>/` — TeamMemberDetailView — edit/remove a member
- `GET/PATCH businesses/<id>/settings/` — BusinessSettingsView — deadlines, cost target, alert %s
- `GET starter-packs/<business_type>/` — StarterPackView — suggested stock/sell items by type
- `GET businesses/<id>/stock-items/` — StockItemListView — `?include_inactive=1` for Settings
- `POST businesses/<id>/stock-items/bulk/` — StockItemBulkCreateView — all-or-nothing row validation
- `GET/PATCH businesses/<id>/stock-items/<item_id>/` — StockItemDetailView — + price history, last
  purchase; PATCH refuses a unit change once purchased/counted, refuses deactivating while an active
  sell item uses it
- `GET businesses/<id>/sell-items/` — SellItemListView — `?include_inactive=1` for Settings
- `POST businesses/<id>/sell-items/bulk/` — SellItemBulkCreateView
- `PATCH businesses/<id>/sell-items/<item_id>/` — SellItemDetailView — `uses_qty` needs a main
  stock item
- `GET businesses/<id>/suppliers/` — SupplierListView — distinct supplier names typed so far
- `GET/POST businesses/<id>/purchases/` — PurchaseListCreateView — list + today/7-day summary, record
- `GET/PATCH/DELETE businesses/<id>/purchases/<pid>/` — PurchaseDetailView — soft-delete on DELETE
- `GET businesses/<id>/counts/form/?type=` — CountFormView — blind form: id/name/unit only
- `GET/POST businesses/<id>/counts/` — CountListCreateView — review list, submit a count
- `GET businesses/<id>/counts/<count_id>/` — CountDetailView — flagged items first, used-since-last
- `POST businesses/<id>/counts/remind/` — CountRemindView — Owner-only, returns a wa.me link
- `GET businesses/<id>/today/` — TodayView — opening/closing state, deadlines, wastage count
- `GET/POST businesses/<id>/wastage/` — WastageListCreateView — role-scoped values
- `DELETE businesses/<id>/wastage/<entry_id>/` — WastageDetailView — Owner-only

## Mobile routes (mobile/app/, file-based via expo-router)

- `_layout.tsx` — root layout: font loading, AuthProvider, offline banner
- `index.tsx` — redirects signed-out → landing, signed-in → /home or /setup/<n>
- `signup.tsx` — create account
- `login.tsx` — mobile + password/PIN
- `+not-found.tsx` — 404
- `setup/1.tsx`..`6.tsx` — onboarding wizard: business info, colour, stock, sell items, team, settings
- `setup/done.tsx` — wizard summary, "still to do" list
- `home.tsx` — Home: OwnerHome (Owner/Manager) or TodayHome (Head chef/Helper), role-branched
- `buy/index.tsx` — Purchases list + today/7-day summary
- `buy/[id].tsx` — Purchase detail, edit, delete
- `stock/index.tsx` — Stock list
- `stock/[id].tsx` — Stock item detail + price chart + recent purchases
- `wastage.tsx` — Wastage list, record, delete
- `count.tsx` — Blind stock count form (opening or closing)
- `counts/index.tsx` — Count review list (Owner/Manager), remind sheet
- `counts/[id].tsx` — Count detail, flagged items first
- `reports.tsx`, `sales.tsx`, `alerts.tsx`, `team.tsx` — ComingSoonScreen stubs
- `settings/index.tsx` — Settings hub (Owner only); `settings/business.tsx`, `settings/brand.tsx` —
  edit screens reusing BusinessForm/BrandForm; `settings/stock.tsx`, `settings/sell.tsx` — list +
  add/edit sheet (StockItemForm/SellItemForm) screens; `settings/alerts.tsx` — the 5 alert settings
- `dev/kit.tsx` — internal UI kit / component gallery, not user-facing
- `dev/health.tsx` — internal backend-reachability probe, not user-facing

## Components in src/ui/ (barrel: src/ui/index.ts)

- `AppShell.tsx` — bottom tab bar (phone) / side nav (≥840px) + "More" sheet, role-aware items
- `BackToWebsiteLink.tsx` — link back to the marketing landing page
- `Banner.tsx` — inline error/success/warning strip
- `BottomActionBar.tsx` — sticky bottom action bar (wizard Next/Save)
- `Button.tsx` — primary/secondary/link variants, loading/disabled states
- `Card.tsx` — bordered content card
- `Checkbox.tsx` — labelled checkbox, 44px target
- `ConfirmDialog.tsx` — centered confirm/cancel dialog (destructive actions)
- `constants.ts` — breakpoints (BREAKPOINT_TABLET=600, NAV_SIDE_BREAKPOINT=840), touch/control sizes
- `EmptyState.tsx` — "nothing here yet" block with optional action
- `Icon.tsx` — named lucide-react-native icon registry (IconName union)
- `MobileField.tsx` — TextField with a fixed "+91" prefix
- `NoAccess.tsx` — "you don't have access" block
- `OfflineRetry.tsx` — offline banner + retry
- `PasswordField.tsx` — TextField + Show/Hide toggle + strength meter
- `PriceChart.tsx` — price-over-time chart with tap/hover tooltip
- `ReadError.tsx` (also exported as `ErrorState`) — "couldn't load, try again"
- `Screen.tsx` — page wrapper: max width, scroll, safe-area padding
- `SessionExpiredDialog.tsx` — forced re-login dialog on a 401
- `Sheet.tsx` — bottom sheet (phone) / centered dialog (≥600px) modal shell
- `Skeleton.tsx` / `SkeletonList.tsx` — loading placeholders
- `StepHeader.tsx` — wizard "Step n of N" + progress bar + back/save-later
- `Text.tsx` — Body/Heading/Muted/Small typography primitives
- `TextField.tsx` — labelled input, 5 states (empty/focused/filled/error/success)
- `Toast.tsx` — transient bottom toast
- `Toggle.tsx` — on/off switch

## Shared state / cross-cutting (mobile/src/)

- `auth/AuthContext.tsx` — signed-in user, businesses list, tokens, authedFetch, login/logout/refresh
- `auth/permissions.ts` — `can(permissions, 'x.y')`, `isLimitedRole(permissions)`
- `auth/storage.ts` — access/refresh token persistence (SecureStore on native, localStorage on web)
- `api/client.ts` — fetch wrapper: base URL, timeout, typed ApiError
- `api/{auth,business,stock,purchases,counts,wastage,team}.ts` — one typed client per backend resource
- `business/routing.ts` — where to send a signed-in user (wizard step vs /home)
- `screens/countDraftStorage.ts` — in-progress blind count draft, survives a reload
- `screens/ComingSoonScreen.tsx` — shared stub for Reports/Sales/Alerts/Team/Settings
- `screens/RecordPurchaseSheet.tsx`, `RecordWastageSheet.tsx` — the two shared record sheets
- `screens/StockItemSheet.tsx`, `SellItemSheet.tsx` — Settings' add/edit sheets (list screen owns
  the list, these own the form + save)
- `forms/StockItemForm.tsx`, `SellItemForm.tsx`, `BusinessForm.tsx`, `BrandForm.tsx` — one shared
  form component each, used by both the setup wizard and Settings
- `strings.ts` — all user-facing copy, one object per screen
- `labels.ts` — copy that varies by business type
- `format.ts` — ₹ and date/time formatting in the business's own timezone
- `theme/tokens.ts` — colours, spacing, radii, type sizes (closed set)
- `theme/brand.ts` — per-business brand colour + WCAG contrast
- `hooks/useMinWidth.ts`, `hooks/useOnlineStatus.ts` — responsive breakpoint, online/offline state

## Scripts and npm commands (root package.json)

- `npm run dev` → `scripts/dev.mjs` — starts backend + Expo web together
- `npm run check` → `check:backend` (ruff via `scripts/check_backend.ps1`) + `check:mobile` (eslint/prettier/tsc)
- `npm run smoke` → `scripts/smoke.py` — backend-only API walk, one user story per feature
- `npm run flow` → `scripts/flow.mjs` — full browser walk: signup→wizard→all 4 roles→core actions
- `npm run responsive` → `scripts/responsive_check.mjs` — every route + sheet/dialog at 7 widths
- `npm run responsive:selftest` — proves the clipping check can actually fail
- `npm run icons` → `scripts/generate_icons.mjs` — app icon set from the source SVG
- `npm run pwa-check` → `scripts/pwa_check.mjs` — manifest/service-worker sanity check
- `npm run build:web` / `serve:web` → `scripts/patch_web_shell.mjs` / `serve_web.mjs` — static web export
- `scripts/lib/landing_server.mjs` — throwaway static server for landing/index.html, used by flow/responsive

## Settings and permissions (backend/businesses/permissions.py, backend/config/settings.py)

| Role | Permissions |
|---|---|
| Owner | purchases.view/create/edit/delete, stock.view, team.manage, settings.manage, stockitems.manage, sellitems.manage, business.manage, counts.create/review, wastage.create/view_all/view_value/delete |
| Manager | purchases.view/create, stock.view, counts.review, wastage.view_all/view_value |
| Head chef | counts.create, counts.status, wastage.create/view_all |
| Helper | counts.create, wastage.create/view_own |

| Business setting | Default | Range |
|---|---|---|
| count_deadline_hour (opening due) | 11 | 0–23 |
| closing_count_hour | 20 | 0–23 |
| target_cost_pct | 30 | 1–100 |
| wastage_alert_pct | 5 | 0–100 |
| rate_creep_pct | 10 | 0–100 |
