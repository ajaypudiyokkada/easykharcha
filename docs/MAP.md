# Repo map

One line per item. Current as of Step 16. Backend API prefix on every endpoint below: `/api/v1/`.

## Backend apps (backend/)

- `accounts/` — signup, login, refresh, logout, /me; models.py (User), serializers.py, otp.py (OTP, unused by UI yet), ratelimit.py (IP/mobile rate limits), validators.py (PIN/password rules), views.py, urls.py
- `audit/` — one audit-log row per write; models.py (AuditLog), log.py (log_action helper), no endpoints
- `businesses/` — business CRUD, onboarding, team, settings, permissions; models.py (Business — Step 21b added `pincode`/`state`/`country`, kept `city`; Access, AccessRole), views.py (`BusinessUpdateView` — Step 23: a `business_type` change with existing items and no `items_action` raises `ItemsDecisionNeeded`), sector_change.py (Step 23's `remove_items_for_sector_change`, keeping items with history or still used by a sell item), team.py, business_settings.py, permissions.py (the role→permission table — Step 23a: `ALL_PERMISSIONS` registry, Owner computed as all of it), access.py (access_or_403/owner_access_or_403), colour.py (brand-colour contrast), serializers.py (`validate_pincode_location`, shared by create/update; `BusinessUpdateSerializer`'s `items_action`), urls.py
- `geo/` — Step 21b: India pincode lookup; models.py (Pincode — pincode/area/district/state/office_type, indexed on pincode), states.py (`INDIA_STATES`), management/commands/load_pincodes.py (idempotent CSV load, `--if-empty` for entrypoint.sh), views.py, exceptions.py (PincodeNotFound), urls.py
- `config/` — Django project config; settings.py, urls.py (root router), exceptions.py (DRF error-shape handler), views.py (health), wsgi.py
- `counts/` — blind stock counts, today status, count review, reminders; models.py (StockCount —
  Step 23b's `missing_opening`, CountLine), views.py (`CountsTodayStatusView`'s `counts/today/`;
  `CountListCreateView.post` raises `OpeningRequired` for a closing with no opening unless the
  opening was missed), business_day.py (`business_date_for` — Step 23b's `day_starts_hour` shift,
  counts/alerts' `opening_late`/`closing_late` only, not sales/wastage/reports/purchases), today_status.py
  (`status_for`'s locked/due/late/done + `next_action`, shared with `today/`), serializers.py,
  gap.py (Step 14's stock-gap math, shared with alerts/), config.py (unusual-value guard constants,
  `CLOSING_GRACE_HOURS`), exceptions.py (`OpeningRequired`), urls.py
- `purchases/` — purchase CRUD, suppliers; models.py (Purchase, PurchaseLine), views.py, serializers.py, exceptions.py, urls.py
- `stock/` — stock items, dishes (SellItem); models.py (StockItem, SellItem — Step 19 added `group`;
  Step 22's `Unit` has 16 pure-label choices, no backend conversion between any of them; Step 22a
  replaced `main_stock_item`/`uses_qty` with `SellItemIngredient` (one row per ingredient, qty
  always in the stock item's own unit) and added `portion_label`/`recipe_status`
  (none/unconfirmed/confirmed — gap.py, reports/service.py and sector_change.py only trust
  `confirmed`)), views.py (`SellItemListView.post` is the single dish create with ingredients,
  always confirmed; `sell-items/bulk/` stays ingredients-free, recipe_status=none, `skip_existing`),
  serializers.py (`SellItemCreateSerializer`/`IngredientRowSerializer`), exceptions.py, urls.py.
  Next step plugs in here: a choice screen before "Add what you sell" (scan/upload vs one by one),
  a bulk-create-without-ingredients caller, `RecipeStatus.UNCONFIRMED`, and
  `DishRecipeForm`'s `stepLabel`/`onSkip` card-flow props — none built yet.
- `wastage/` — wastage entries; models.py (WastageEntry), views.py, serializers.py, urls.py
- `sales/` — manual sales entries (one row per sell item per business date); models.py (Sale), views.py, serializers.py, exceptions.py, urls.py
- `alerts/` — Step 15: alerts computed on read (opening_late/closing_late — Step 23b's split of the
  old count_late, price_rise, wastage_high, gap_flagged, Step 18's expiry_soon), never scheduled;
  models.py (AlertCheck), service.py (compute_alerts/open_alerts), views.py, serializers.py, urls.py
- `reports/` — Step 16: the six Reports blocks computed on read, no models; service.py (summary_for — reuses counts/gap.py's lines_with_gap/unit_cost_for for every gap figure), views.py, urls.py
- Step 21a: Django admin (platform staff only, not business roles) at env `ADMIN_URL_PATH` (default
  `manage-ek/`); `admin.py` in accounts/businesses/stock/alerts (editable) and counts/purchases/
  sales/wastage/audit (read-only); `config/admin_security.py` (login rate limit), `config/
  admin_mixins.py` (the read-only mixins)

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
- `GET/POST businesses/<id>/team/` — TeamListCreateView — list team (team.manage or team.view), add
  a member (team.manage); list includes `last_login_at`/`added_at` per member
- `PATCH/DELETE businesses/<id>/team/<access_id>/` — TeamMemberDetailView — edit role (Helper/Head
  chef swap freely; crossing the Manager boundary needs a new `secret` in the same request) / remove
  a member (blacklists their refresh tokens)
- `POST businesses/<id>/team/<access_id>/reset-secret/` — TeamResetSecretView — Owner resets a
  member's PIN/password, blacklists their refresh tokens, clears lockout; refused for the caller's
  own Owner access, never logs the secret
- `GET/PATCH businesses/<id>/settings/` — BusinessSettingsView — deadlines, cost target, alert %s
- `GET starter-packs/<business_type>/` — StarterPackView — suggested stock/sell items by type; Step
  20 added `group`/`goes_off`/`shelf_life_days` to every stock item, for all 9 business types
- `GET businesses/<id>/stock-items/` — StockItemListView — `?include_inactive=1` for Settings
- `POST businesses/<id>/stock-items/bulk/` — StockItemBulkCreateView — all-or-nothing row validation,
  unless the body sets `skip_existing: true` (Step 20), which quietly drops already-there/duplicate
  names instead of erroring — what the starter-stock picker's Continue sends
- `GET/PATCH businesses/<id>/stock-items/<item_id>/` — StockItemDetailView — + price history, last
  purchase; PATCH refuses a unit change once purchased/counted, refuses deactivating while an active
  sell item uses it
- `GET businesses/<id>/sell-items/` — SellItemListView — Owner (`sellitems.manage`, `?include_inactive=1`
  for Settings) or Owner/Manager (`sales.view`/`sales.create`, active items only, for Record sales)
- `POST businesses/<id>/sell-items/bulk/` — SellItemBulkCreateView
- `PATCH businesses/<id>/sell-items/<item_id>/` — SellItemDetailView — `uses_qty` needs a main
  stock item
- `GET businesses/<id>/suppliers/` — SupplierListView — distinct supplier names typed so far
- `GET/POST businesses/<id>/purchases/` — PurchaseListCreateView — list + today/7-day summary, record
- `GET/PATCH/DELETE businesses/<id>/purchases/<pid>/` — PurchaseDetailView — soft-delete on DELETE
- `GET businesses/<id>/counts/form/?type=` — CountFormView — blind form: id/name/unit only
- `GET businesses/<id>/counts/today/` — CountsTodayStatusView — Step 23b: opening/closing
  locked/due/late/done + `next_action`, `counts.create` or `counts.review`, no stock quantities
- `GET/POST businesses/<id>/counts/` — CountListCreateView — review list (Owner/Manager get a
  `flagged_gaps` count per row), submit a count
- `GET businesses/<id>/counts/<count_id>/` — CountDetailView — gap-flagged items first, then
  not-sure/confirmed-unusual, then the rest; Owner/Manager lines also carry `expected_used`,
  `gap_qty`, `gap_value`, `gap_status`, `gap_reason` (Step 14) — never sent to Head chef/Helper,
  who can't reach this endpoint at all (no `counts.review`)
- `POST businesses/<id>/counts/remind/` — CountRemindView — Owner-only, returns a wa.me link
- `GET businesses/<id>/today/` — TodayView — same opening/closing status as `counts/today/` (shared
  `today_status.status_for`), plus wastage count, `alerts_count` (Owner/Manager only)
- `GET/POST businesses/<id>/wastage/` — WastageListCreateView — role-scoped values
- `DELETE businesses/<id>/wastage/<entry_id>/` — WastageDetailView — Owner-only
- `GET/POST businesses/<id>/sales/` — SaleListCreateView — list (newest first, paginated, date-range
  filter) + summary (sales today, items sold today, last update, last 7 days); POST takes one
  business_date and 1-30 lines (sell_item, quantity, optional amount)
- `DELETE businesses/<id>/sales/<sid>/` — SaleDetailView — Owner-only, soft-delete
- `GET businesses/<id>/alerts/` — AlertListView — `?type=` filter; open (unchecked) alerts + per-type/total counts
- `POST businesses/<id>/alerts/check/` — AlertCheckView — `{key}`, hides the alert until its key changes
- `GET businesses/<id>/reports/summary/?period=today|7d|30d|90d&item=` — ReportsSummaryView — one call,
  six blocks: money_went, used_vs_expected, wastage_trend, price_trend (`?item=` picks the stock item,
  default the one with the largest rise), sales_vs_cost, biggest_gaps
- `GET geo/pincode/<code>/` — PincodeDetailView — Step 21b: `{pincode, state, districts, areas}`, 400
  for a badly-shaped code, 404 for one not in the table

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
- `counts/[id].tsx` — Count detail: gap-flagged items first, then not-sure/confirmed-unusual, then
  the rest; Owner/Manager lines show expected used and the gap (qty + Rs value), red when flagged; a
  not_comparable line shows a one-line reason linking to What you sell or Sales for that date
- `reports.tsx` — Reports (Owner, Manager): period chips (Today/7 days/30 days/3 months), six report
  cards (money went, used vs expected, wastage trend, price trend with an item picker, sales vs cost,
  biggest gaps), each with a real takeaway, "View as table" and one button; `?period=` sets the
  initial chip
- `alerts/index.tsx` — Alerts (Owner/Manager): filter chips (type + count), severity-coloured list;
  `alerts/[key].tsx` — detail: plain-language detail line, the numbers, primary next action, "Mark
  as checked"
- `sales.tsx` — Sales (Owner/Manager): summary strip, "Record sales", a date switcher, today's sales,
  Owner-only delete via confirmation dialog
- `team/index.tsx` — Team list (Owner: full + "Add team member"; Manager: view-only); `team/[id].tsx`
  — member detail (Owner: Change role, Reset PIN/password, Remove from team; Manager: read-only)
- `settings/index.tsx` — Settings hub (Owner only); `settings/business.tsx`, `settings/brand.tsx` —
  edit screens reusing BusinessForm/BrandForm; `settings/stock.tsx` — Step 19's inline add
  (instant-save, GroupedList) + edit Sheet (StockItemForm); Step 20 added its "Add from starter
  list" button, opening `StarterStockPickerSheet`; `settings/sell.tsx` — the dish list (badges:
  "Needs ingredients"/"Estimate - confirm"), a quick no-ingredients add box (SellItemForm) and
  "Add {label}" opening `SellItemSheet` (DishRecipeForm, add or edit); `?filter=needs_ingredients`
  and `?edit=<id>` query params drive it from Home's nudge and a count-gap reason link;
  `settings/alerts.tsx` — the 6 alert settings (Step 18 added expiry_warn_days; the hub's "Expiry
  alerts" row links here too, not its own screen)
- `dev/kit.tsx` — internal UI kit / component gallery, not user-facing
- `dev/health.tsx` — internal backend-reachability probe, not user-facing

## Components in src/ui/ (barrel: src/ui/index.ts)

- `AppShell.tsx` — bottom tab bar (phone) / side nav (≥840px) + "More" sheet, role-aware items; also
  the top bar avatar (phone) / user block (desktop side nav) that opens the profile sheet
- `Avatar.tsx` — initials circle, the only avatar anywhere in the app (no profile photos)
- `BackToWebsiteLink.tsx` — link back to the marketing landing page
- `Banner.tsx` — inline error/success/warning strip
- `BottomActionBar.tsx` — sticky bottom action bar (wizard Next/Save)
- `Button.tsx` — primary/secondary/link variants, loading/disabled states
- `Card.tsx` — bordered content card
- `Checkbox.tsx` — labelled checkbox, 44px target
- `ConfirmDialog.tsx` — centered confirm/cancel dialog (destructive actions)
- `constants.ts` — breakpoints (BREAKPOINT_TABLET=600, NAV_SIDE_BREAKPOINT=840), touch/control sizes
- `EmptyState.tsx` — "nothing here yet" block with optional action
- `GroupedList.tsx` — Step 19: collapsible group headings (Ungrouped last) over a flat item list —
  Settings' stock/sell lists, the wizard's "added items" list, DishRecipeForm's ingredient picker;
  Step 20 added optional `countLabel`/`headerAccessory` props for the starter-stock picker's "N of
  M" + Select all
- `Icon.tsx` — named lucide-react-native icon registry (IconName union)
- `MobileField.tsx` — TextField with a fixed "+91" prefix
- `NoAccess.tsx` — "you don't have access" block
- `OfflineRetry.tsx` — offline banner + retry
- `PasswordField.tsx` — TextField + Show/Hide toggle + strength meter
- `PriceChart.tsx` — Step 9's hand-rolled single-series price chart (Stock item detail)
- `charts/BarChart.tsx`, `charts/LineChart.tsx` — Step 16: react-native-svg + d3-scale/d3-shape/
  d3-array; stacked/grouped bars or 1-3 lines (+ an optional dashed reference series), nearest-point
  tap/hover, legend, "View as table"; `charts/shared.tsx` (header/takeaway/legend/table/empty/axis
  formatting), `charts/types.ts` (`ChartSeries`)
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

- `auth/AuthContext.tsx` — signed-in user, businesses list, tokens, authedFetch, login/logout/refresh,
  setActiveBusiness (moves a business to the front of the list — "Switch business")
- `auth/permissions.ts` — `can(permissions, 'x.y')`, `isLimitedRole(permissions)`
- `auth/storage.ts` — access/refresh token persistence (SecureStore on native, localStorage on web)
- `api/client.ts` — fetch wrapper: base URL, timeout, typed ApiError
- `api/{auth,business,stock,purchases,counts,wastage,team,sales,alerts,reports,geo}.ts` — one typed
  client per backend resource (`geo.ts` is Step 21b's `PincodeLookup` type only, no fetch helper — the
  fetch itself is in `PincodeLocationField.tsx`, like every other screen-level `authedFetch` call)
- `business/routing.ts` — where to send a signed-in user (wizard step vs /home)
- `screens/countDraftStorage.ts` — in-progress blind count draft, survives a reload
- `forms/groupItems.ts`, `forms/validateStockItem.ts`, `forms/validateSellItem.ts`,
  `forms/validateNumber.ts`, `forms/itemDraftStorage.ts` — Step 19: grouping, shared client-side
  validation and duplicate-name checks, and half-typed-add-form persistence, one of each, reused by
  every stock/sell-item add form instead of four separate copies
- `hooks/useInstantAdd.ts` — Step 19: one Add tap saves immediately (optimistic, rolled back on
  failure) and clears/refocuses the form — used by setup/3, setup/4 and both Settings item lists
- `screens/ComingSoonScreen.tsx` — shared stub for Team/Settings
- `screens/ProfileSheet.tsx` — name/role/business, Switch business (if >1), Account (coming soon),
  Log out — the only place Log out lives now, opened from AppShell's avatar/user block
- `screens/RecordPurchaseSheet.tsx`, `RecordWastageSheet.tsx`, `RecordSalesSheet.tsx` — the shared
  record sheets
- `screens/ChangeBusinessTypeSheet.tsx` — Step 23: the keep-or-remove-items sheet shown on a
  `business_type` change, from setup/1 (going back) and Settings' Business profile
- `screens/TeamAddSheet.tsx`, `ChangeRoleSheet.tsx`, `ResetSecretSheet.tsx` — Team screen sheets: add
  a member, change role (asks for a new secret only when crossing the Manager boundary), reset a
  PIN/password
- `screens/StockItemSheet.tsx` — Settings' stock add/edit sheet; `SellItemSheet.tsx` — Step 22a:
  Settings' dish add/edit sheet, wrapping `DishRecipeForm` (null `editingItem` = create)
- `screens/StarterStockPicker.tsx` — Step 20: the grouped/searchable starter-stock picker (setup/3
  and Settings); `StarterStockPickerSheet.tsx` wraps it in a Sheet with its own Continue button for
  the Settings entry point
- `forms/StockItemForm.tsx`, `BusinessForm.tsx`, `BrandForm.tsx` — one shared form component each,
  used by both the setup wizard and Settings; `SellItemForm.tsx` — the quick, no-ingredients dish
  fields (name/price/portion/group) shared by the wizard and Settings' quick-add box only; Step
  22a's `DishRecipeForm.tsx` (+ `unitConversion.ts`'s g<->kg/ml<->L entry-time conversion,
  `validateDish.ts`) is the full dish form with ingredients, used only via `SellItemSheet`
- `forms/PincodeLocationField.tsx` — Step 21b: Country (fixed) + Pincode lookup -> State (read-only) +
  City (the pincode's district(s), first preselected) + optional searchable Area; "Enter city
  yourself" falls back to free-text City + a State picker (sets `manual_location`) when a pincode
  isn't found. Used inside `BusinessForm.tsx` in place of the old free-text City; an existing business
  with a city but no pincode shows a plain "Add pincode" prompt instead of forcing one.
  `constants/indiaStates.ts` has the State picker's options (kept in sync with `geo/states.py`).
- `strings.ts` — all user-facing copy, one object per screen
- `sectorCopy.ts`/`sectorCopy.json` — Step 22: the one config, keyed by all 9 `BusinessType`s, for
  every sector-varying string and unit list (stock/sell nouns, placeholders, group suggestions, the
  "uses" picker label/help, shared/goes-off toggle wording, count/wastage help, `allowedUnits`/
  `defaultUnit`, the Head-chef role label; Step 22a added `sellGroupSuggestions`/
  `sellPortionPlaceholder`); `labels.ts` is now a thin wrapper over it
- `labels.ts` — copy that varies by business type (delegates to sectorCopy.ts)
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
- `npm run icons` → `scripts/generate_icons.mjs` — favicon/PWA icon set from `docs/images/ek_logo_icon.png`
- `npm run pwa-check` → `scripts/pwa_check.mjs` — manifest/service-worker sanity check
- `npm run check:sector-copy` → `scripts/check_sector_copy.py` — Step 22: fails if food wording
  (dish, chef, kitchen, ingredient, ...) appears in a non-food business type's sectorCopy.json or
  starter_packs.json, or a catalogue item's unit isn't in its type's `allowedUnits`
- `npm run build:web` / `serve:web` → `scripts/patch_web_shell.mjs` / `serve_web.mjs` — static web export
- `scripts/lib/landing_server.mjs` — throwaway static server for landing/index.html, used by flow/responsive

## Settings and permissions (backend/businesses/permissions.py, backend/config/settings.py)

| Role | Permissions |
|---|---|
| Owner | all 25 — `ALL_PERMISSIONS` computed, not hand-listed (Step 23a); see `docs/STATUS.md`'s permission table |
| Manager | purchases.view/create, stock.view, counts.review, wastage.view_all/view_value, team.view, sales.view/create, alerts.view/check, reports.view |
| Head chef | counts.create, counts.status, wastage.create/view_all |
| Helper | counts.create, wastage.create/view_own |

| Business setting | Default | Range |
|---|---|---|
| day_starts_hour (Step 23b: business date = date of count time minus this) | 5 | 0–12 |
| count_deadline_hour (opening due) | 11 | 0–23 |
| closing_count_hour | 20 | 0–23 |
| target_cost_pct | 30 | 1–100 |
| wastage_alert_pct | 5 | 0–100 |
| rate_creep_pct | 10 | 0–100 |
| gap_alert_pct (stock-gap flag threshold) | 10 | 0–100 |
| expiry_warn_days (expiry_soon alert lead time) | 2 | 1–30 |
