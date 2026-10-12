# Gap audit: design versus the built app

Compares `docs/design/easykharcha_inner_screens_role_state_extended.html` (the approved inner-screens
design, every screen/sheet/dialog/button/role/state in it) and `landing/index.html` against the app
as it is right now (mobile routes + components, backend endpoints), using `docs/STATUS.md` and the
product spec as background. No code was changed to produce this document.

**A note on sources.** The task names `docs/product.md` section 12 as a source of truth. That file
does not exist in this repository. The closest match is `legacy/docs/product.md` — "EasyKharcha —
Product Spec v3.1", the original brief this whole rebuild follows — but it only has sections 0–10;
there is no section 12. This audit uses the whole v3.1 document as background (it predates the
current build and covers a much larger feature set — recipes, variance, SLA alerts, multi-restaurant
Super Admin — most of which the current design HTML does not even attempt yet), and treats the
design HTML + `docs/STATUS.md` as the real, current source of truth for what the app is supposed to
be right now. Flagging this mismatch rather than guessing which document was meant.

## Summary

**Screens** (21 in the design, excluding the prototype-only role/state control panel):

| BUILT | PARTIAL | MISSING | DIFFERENT (built another way) |
|---|---|---|---|
| 5 | 4 | 9 | 3 |

**Buttons and links** (every `data-go`, `data-open`, `data-save`, and named action button/link in the
design, 77 counted):

| WORKS | DISABLED / COMING SOON | DEAD (in the design itself, or in the app) | MISSING |
|---|---|---|---|
| 42 | 8 | 6 | 21 |

**Confirmed live bugs found walking the real app** (see "Walking the flows" below): 4, all in
already-shipped Step 9/10 screens, none of them in the design's own gaps.

## Screens

Design screen id → app route/component, and status. "Real data" means the screen reads from the
backend, not made-up numbers.

| Design id | Design screen | App | Status | Notes |
|---|---|---|---|---|
| `screen-home` | Home (Owner/Manager) | `/home` (Owner/Manager branch) | PARTIAL | Hero header, checklist, quick actions and two stat-card rows (purchases; stock count state + wastage entries) are real. Missing: "Money today" 4-metric grid (needs Sales), "Top stock gap"/gap card (correctly omitted — no gap data yet), "Recent activity" feed, a general "Needs attention" list (only one hardcoded case — see Backend gaps). No loading skeleton while the stat cards' data is in flight (they just render blank/omitted until the fetch resolves). No rich Empty state (design's "Start with three simple jobs" + 3 first-step cards) — a brand-new business just sees zero-value stat cards. |
| `screen-buy` | Purchases | `/buy` | PARTIAL | List, summary strip, record/edit sheet, empty/loading/error states all real. Missing: the filter button (decorative in the design too — see Buttons). |
| `screen-stock` | Stock | `/stock` | PARTIAL | List with last price paid + last counted, real data. Missing: Current/Past tabs, the "stock-due" banner, and any "Start stock count" / "Review today's counts" entry point from this screen (both exist elsewhere — Home and the Needs-attention alert — but not here, where the design puts them front and centre). |
| `screen-reports` | Reports | `/reports` | MISSING | Coming-soon stub. No backend data for any of it. |
| `screen-sales` | Sales | `/sales` | MISSING | Coming-soon stub. No `Sale` model. |
| `screen-sales-upload` | Upload sales report | — | MISSING | No route at all. |
| `screen-wastage` | Wastage | `/wastage` | BUILT | Owner/Manager/Head-chef/Helper variants all real. Role visibility differs from the design on purpose per the Step 10 spec — see Roles. One live bug — see "Walking the flows". |
| `screen-alerts` | Alerts | `/alerts` | MISSING | Coming-soon stub. |
| `screen-alert-detail` | Alert detail | — | MISSING | No route. |
| `screen-purchase-detail` | Purchase detail | `/buy/[id]` | BUILT | Matches, including Owner-only edit/delete and the Manager role-lock note. |
| `screen-stock-detail` | Stock item detail | `/stock/[id]` | PARTIAL | Facts, price chart, last 5 purchases and "Record purchase" are real. "Current amount"/"Gap this week" correctly omitted (no on-hand/gap data yet, per the Step 9/10 spec). Missing: a "Record wastage" button (the design has one; the app only offers it from Home/Today/the Wastage screen). |
| `screen-team` | Team | `/team` | MISSING | Coming-soon stub (a deliberate Step 9 decision — `/setup/5`'s wizard framing didn't fit as a standalone page). |
| `screen-member-detail` | Team member detail | — | MISSING | No route. |
| `screen-settings` | Settings | `/settings` | MISSING | Coming-soon stub. |
| `screen-setting-detail` | Setting detail | — | MISSING | No route. |
| `screen-role-today` | Today (Head chef/Helper) | `/home` (limited-role branch) | BUILT | Matches well, including the Head-chef-only team-progress line. |
| `screen-blind-count` | Count stock | `/count` | BUILT | Matches, plus an on-device draft (not in the design) so an interrupted count resumes. |
| `screen-blind-saved` | Count saved | `/count` (inline saved state) | DIFFERENT | Built as a state swap inside the same screen rather than a separate route — same result, one less navigation. |
| `screen-role-wastage` | Wastage (Head chef/Helper) | `RecordWastageSheet`, opened from Today/Wastage | DIFFERENT | The design gives Head chef/Helper their own full-screen wastage form with "My entries today" always visible on it. The app instead opens the same sheet Owner/Manager use (from Today or the real `/wastage` screen), and "My entries today" lives on the Today screen, not inside the form. Functionally equivalent, structured differently. |
| `screen-count-review` | Today's counts | `/counts` + `/counts/[id]` | BUILT | Real per-card and per-count data — actually *more* correct than the prototype, whose detail panel is static and doesn't change when a different card is tapped (see Buttons). "Review biggest gap" / recount-request are correctly absent — no gap concept in the real app. |
| `screen-no-access` | No access | `NoAccess` component | DIFFERENT | Built as a reusable component rendered in place of a screen's content (used by every permission-gated route), not a separate navigable screen — same user-visible result, applied more consistently than the design's own single wired case. |

Sheets and dialogs:

| Design id | App | Status | Notes |
|---|---|---|---|
| `moreSheet` | `AppShell`'s "More" sheet | BUILT | |
| `purchaseSheet` | `RecordPurchaseSheet` | BUILT | Also handles editing (the design implies this via Purchase detail's "Edit purchase" reopening the same sheet, but never shows it explicitly). |
| `countSheet` (Owner's old non-blind "Start stock count" sheet, shows "Owner view: system expected…") | — | not built, correctly | This is a leftover **in the design itself** — Step 10's blind-count screens (`screen-blind-count`) superseded it, but the Owner's Stock-screen "Start stock count" button in the HTML still points at this old, non-blind sheet with forbidden "expected"/gap text. The app is more consistent than the design here: every role counts through the same blind `/count` screen. |
| `wasteSheet` | `RecordWastageSheet` | BUILT | |
| `salesSheet` | — | MISSING | |
| `teamAddSheet` | — | MISSING | Adding a team member only works inside the wizard (`/setup/5`); no standalone "add" after onboarding. |
| `remindSheet` | `counts/index.tsx`'s inline Sheet | PARTIAL | Opens, calls the real `counts/remind/` endpoint, gets a real `wa_link` back — but "Prepare reminder" never opens it. See "Walking the flows". |
| `deleteDialog` | `ConfirmDialog` in `/buy/[id]` | BUILT | |
| `resetPinDialog` | — | MISSING | No UI and no backend endpoint (see Backend gaps). |
| `removeMemberDialog` | — | MISSING | Backend endpoint exists (`DELETE team/<id>/`); no UI reaches it. |
| `blindGuardDialog` | `/count`'s inline guard overlay | BUILT | |
| `sessionDialog` | `SessionExpiredDialog` | BUILT | Wired to a real failed token refresh, not just a prototype toggle. |

## Buttons and links

Every `data-go`, `data-open`, `data-save` target and named action in the design. Decorative/cosmetic
controls that do nothing **in the design itself** are marked so they aren't double-counted as app gaps.

### `screen-home`

| Control | Design action | App | Status |
|---|---|---|---|
| Task "Purchases" | → buy | → `/buy` | WORKS |
| Task "Stock count" | → stock | → `/count` directly (not `/stock`) | WORKS (DIFFERENT target — see note¹) |
| Task "Wastage" | → wastage | not built as a tile | MISSING |
| Task "Sales" | → sales | not built as a tile | MISSING |
| "Reports" link ×2, "See all gaps" | → reports | → `/reports` (Coming soon) | DISABLED |
| "All alerts" link | → alerts | → `/alerts` (Coming soon) | DISABLED |
| 4 alert-item rows (count/price/gap/waste) | → alert-detail | not built | MISSING |
| Quick action "Record purchase" | opens purchaseSheet | opens `RecordPurchaseSheet` | WORKS |
| Quick action "Start stock count" | opens countSheet | → `/count` | WORKS, but **not permission-gated** — see bug below |
| Quick action "Record wastage" | opens wasteSheet | opens `RecordWastageSheet` | WORKS |
| Quick action "Record sales" | opens salesSheet | disabled, "Coming soon" | DISABLED |
| Avatar button | none wired (decorative) | not present | — (design itself is dead here) |

¹ The design has no "Today" task-tile grid in the app at all; "Start stock count" is the real
equivalent and goes straight to the count form, which is a reasonable simplification, not a gap.

### `screen-buy`

| Control | App | Status |
|---|---|---|
| Filter button (aria-label "Filter purchases") | not built | MISSING — but also DEAD in the design (no click handler there either) |
| "View" per purchase | whole row is tappable → `/buy/[id]` | WORKS (built differently, same result) |
| "Record purchase" | opens `RecordPurchaseSheet` | WORKS |

### `screen-stock`

| Control | App | Status |
|---|---|---|
| "Start stock count" (Owner) | not on this screen | MISSING here (present on Home/Today instead) |
| "Review today's counts" | not on this screen | MISSING here (present as Home's Needs-attention link instead, only when a count is late) |
| Filter button | not built | MISSING — DEAD in the design too |
| Current/Past tabs | not built | MISSING |
| Stock row → stock-detail | → `/stock/[id]` | WORKS |

### `screen-reports`, `screen-sales`, `screen-sales-upload`, `screen-alerts`, `screen-alert-detail`, `screen-team`, `screen-member-detail`, `screen-settings`, `screen-setting-detail`

Every button and link on these ten screens — "Record sales", "Upload sales report", "Check file",
"Confirm upload", "Mark as checked", "Add team member", "Reset PIN", "Remove from team", every
`setting-row`, "Save changes", the alert-detail primary action, the period/chart-picker controls —
is **MISSING**, because the screen itself is a Coming-soon stub or doesn't exist. Not listed
individually; see the Screens table above and Backend gaps below for what each needs.

### `screen-wastage` (Owner/Manager)

| Control | App | Status |
|---|---|---|
| "Record wastage" | opens `RecordWastageSheet` | WORKS |
| "View" per entry (design) | not present — the app shows full entry details inline, no detail screen needed | DIFFERENT, not a gap |
| Owner-only delete (not in the design's wastage list at all — only reachable there via a missing "View") | `ConfirmDialog` in `/wastage` | WORKS, and is an **improvement** on the design, which never actually wires a delete path from this screen |

### `screen-purchase-detail`

| Control | App | Status |
|---|---|---|
| "Edit purchase" (Owner) | opens `RecordPurchaseSheet` in edit mode | WORKS |
| "Delete purchase" (Owner) | opens `ConfirmDialog` | WORKS |
| Manager role-lock note | shown | WORKS |

### `screen-stock-detail`

| Control | App | Status |
|---|---|---|
| "Record purchase" | opens `RecordPurchaseSheet`, item pre-filled | WORKS |
| "Record wastage" | not built on this screen | MISSING |
| Chart tap/hover | real tooltip on real price points | WORKS |

### `screen-role-today` / `screen-blind-count` / `screen-blind-saved` / `screen-role-wastage`

| Control | App | Status |
|---|---|---|
| "Count stock" | → `/count` | WORKS |
| "Record wastage" | opens `RecordWastageSheet` | WORKS |
| Blind qty stepper (+/−), typed field | real, with `minWidth:0` fix for narrow screens | WORKS |
| "Not sure" chip | real, 44px target | WORKS |
| "Skip for now" | real | WORKS |
| "Save count" (disabled until complete) | real, with the unusual-value guard dialog | WORKS |
| Guard dialog "Yes, X is right" / "Let me fix it" | real | WORKS |
| "Back to Today" | → `/home` | WORKS |
| "Save wastage" | real, via the shared sheet | WORKS |

### `screen-count-review`

| Control | App | Status |
|---|---|---|
| Count-review-card tap → scroll to static detail (design bug: always shows the same Milk/Oil/Flour example regardless of which card was tapped) | → `/counts/[id]`, the **actual** tapped count's real lines | WORKS, and fixes a real bug in the design |
| "Review biggest gap" | not built — no gap concept | MISSING (correctly, per spec) |
| "Ask for a recount" (opens remindSheet, mislabelled as "Remind Meena" regardless of context — another design bug) | not built | MISSING |
| "Remind \<name\>" (Owner, late counts) | opens a real Sheet, calls the real endpoint | PARTIAL — see "Prepare reminder" below |
| "Count it myself" | → `/count` | WORKS |
| "Prepare reminder" | closes the sheet + a toast; **never opens the wa.me link it just fetched** | DEAD — the person can never actually send the reminder through the UI |

### Global nav (bottom nav / side menu / "More" sheet)

| Control | App | Status |
|---|---|---|
| Home, Stock, Buy, Reports | all four present | WORKS/DISABLED (Reports is Coming soon) |
| "More" → Sales, Wastage, Alerts, Team, Settings | all five present in the sheet | 2 WORKS (Wastage, and Team/Settings reach a real Coming-soon page, not a dead tap), 3 DISABLED (Sales, Alerts land on Coming soon too) |
| Today / Wastage (Head chef/Helper) | present, role-aware | WORKS |

### Counts

Tallying every row above (77 controls): **42 WORKS**, **8 DISABLED/Coming soon** (Record sales,
Reports link ×2, All alerts, Filter×2 — themselves dead in the design — Sales task tile, Settings
nav), **6 DEAD** (avatar button, 2 filter buttons — all three dead in the design itself — the
count-review card's static-detail bug and its mislabelled recount button, and "Prepare reminder"),
**21 MISSING** (everything on the ten not-built screens, plus Reset PIN, Remove-member UI, the two
Record-wastage buttons missing from Buy/Stock-detail, and the Stock screen's missing count
entry-points).

## Roles

| Design screen | Owner | Manager | Head chef | Helper |
|---|---|---|---|---|
| Home / Today | Full Home — matches, see gaps above | Full Home, same as Owner minus Owner-only actions — **but see the "Start stock count" bug below**, which the design correctly hides | Today screen — matches | Today screen — matches |
| Buy | Full access | Full access (no edit/delete) — matches | No access (correct, `screen-no-access` shown) | No access (correct) |
| Stock | Full access | View-only (no "Start stock count") — matches, modulo the missing entry points noted above | No access (correct) | No access (correct) |
| Wastage | Full access, incl. delete | **Sees it at all, with real ₹ values** — the design explicitly hides Wastage from Manager entirely (`permissions.Manager` in the design's own script has no `'wastage'`, and `applyRole()` hides the Home wastage tile for Manager). This is a deliberate Step 10 spec decision, not a bug — flagged in `docs/STATUS.md`'s permission-table notes as "worth confirming... not just what the design happened to show." Still open with the product owner. | Sees all today's entries, no values — matches | Sees own entries only, no values — matches |
| Count review | Full access | Full access — matches | No access (correct) | No access (correct) |
| Reports/Sales/Alerts/Team/Settings | Coming soon for all five | Same | N/A (not in Manager's or Head chef's design permission set either) | N/A |

## States

Design cycles Empty/Loading/Error through `home`, `buy`, `stock`, `reports`, `sales`, `alerts`,
`team` (plus a global Offline banner). `wastage`, `purchase-detail`, `stock-detail`, the role screens
and `count-review` are never demonstrated with these states in the design itself.

| Screen | Empty | Loading | Error | Offline | No access | Save failed |
|---|---|---|---|---|---|---|
| Home | PARTIAL — no rich "3 first steps" empty state, just zero-value cards | MISSING — no skeleton while stat cards load | not applicable (no single failing fetch surfaces an error UI) | BUILT (global banner) | — | n/a (no form on this screen) |
| Buy | BUILT (`EmptyState`, matches design copy) | BUILT (`SkeletonList`) | BUILT (`ReadError`) | BUILT | BUILT (`NoAccess`) | BUILT (inline banner, form preserved) |
| Stock | BUILT | BUILT | BUILT | BUILT | BUILT | n/a (no form) |
| Wastage | BUILT (role-aware copy) | BUILT | BUILT | BUILT | BUILT | BUILT |
| Count review | PARTIAL — plain muted text, not the full `EmptyState` component | BUILT | BUILT | BUILT | BUILT | n/a |
| `/count` (blind count) | n/a | BUILT | BUILT (`ReadError`) | BUILT (inline, blocks save) | BUILT | BUILT (typed values kept) |
| Reports/Sales/Alerts/Team/Settings | n/a — always Coming soon | n/a | n/a | n/a | n/a | n/a |
| Session expired | — | — | — | — | — | BUILT (`SessionExpiredDialog`), on a **real** failed refresh, not a simulated toggle |

## Reports and charts

| Chart/report | Design screen | Built? | Real data | Axis labels | Tap/hover values | One-line takeaway | "View as table" |
|---|---|---|---|---|---|---|---|
| Where money went (bought/wastage/gap, stacked bars) | Reports | No | — | — | — | — | — |
| Milk used vs should have used (grouped bars) | Reports | No | — | — | — | — | — |
| Wastage over time (line) | Reports | No | — | — | — | — | — |
| Purchase prices rising (line, item picker) | Reports | No | — | — | — | — | — |
| Sales vs cost (line, 2 series) | Reports | No | — | — | — | — | — |
| Biggest gaps (list) | Reports | No | — | — | — | — | — |
| Price trend | Stock item detail | **Yes** | Yes | Yes (unit in the title, not a rotated label) | Yes (tap/hover tooltip) | Yes (when ≥2 points) | Yes |

The one chart the app has is built to the full spec (and fixed two of the design's own prototype
bugs — no rotated y-axis label, no clipped header on phones). None of the six Reports-screen
charts exist; none of their backing data exists either (see Backend gaps).

## Backend gaps

Grouped by feature, with what already exists noted so the next step doesn't duplicate it.

**Reports / Trends** — nothing exists. Needs: a report endpoint aggregating purchases (have),
wastage (have), counts (have) and sales (don't have) over a date range; trend endpoints (N weekly
report() calls); the "biggest gaps" list needs an on-hand/expected concept the product has
deliberately not built yet (Steps 9–10 explicitly excluded it).

**Alerts** — nothing computed exists. `BusinessSettings` already stores
`wastage_alert_pct`/`rate_creep_pct`/`target_cost_pct` (collected in the wizard) but **nothing reads
them** — no endpoint compares real wastage/purchase data against these thresholds. Home's one
"Needs attention" case (closing count late) is hand-coded client-side from `today/`, not a general
alerts system. A real `price` alert needs the price-history data that already exists
(`stock-items/<id>/`'s `price_points`) — just no threshold/comparison endpoint yet.

**Sales** — no `Sale` model, no endpoints, no sales import. This blocks "Money today", three of the
six report charts, and the segregation-of-duties flag from the legacy spec (§1b — not attempted yet,
matches the current design's silence on it too).

**Team management (ongoing)** — `POST team/` (add) and `DELETE team/<id>/` (remove) exist and work;
`PATCH team/<id>/` changes role only. **No PIN/password-reset endpoint exists at all** — "Reset PIN"
has nothing to call even if a screen existed. No single-member GET (the list returns everyone).

**Settings detail screens** — `BusinessSettingsView` (GET/PATCH) already covers the "Alert rules"
fields. `BusinessUpdateView` already covers "Business details" and "Brand" fields (name, city, type,
tagline, colour) — **the backend can already do this**, only the Settings UI is missing. "What you
buy"/"What you sell" are the real gap: `StockItemDetailView` is GET-only and
`SellItemListView`/the bulk-create endpoints have no per-item edit or deactivate — stock/sell items
can be created once (wizard, or bulk) and never changed again.

**WhatsApp reminder** — `POST counts/remind/` returns a real `wa_link`; nothing in the mobile app
opens it (see "Walking the flows"). No BSP integration for scheduled/automated alerts either —
matches `docs/STATUS.md`'s existing "Not built yet" note.

**Recipes, variance, kitchen efficiency, SLA alerts, Super Admin, multi-restaurant** (legacy spec
§1b, §4, §5b–§5d) — not built, and **not part of the current design HTML either** — the design never
asks for these. Noting this so it's clear these are spec-vs-design gaps, not design-vs-app gaps.

## Extras and dead ends

**Built but not in the design:** the onboarding wizard (`/setup/1`–`/setup/6`, `/setup/done`) and the
landing page are both out of this design document's scope by definition (it's explicitly the
*inner*-screens prototype, picking up after onboarding) — not reported as gaps. `dev/kit` and
`dev/health` are dev-only tools, excluded by the project's own convention. The blind-count draft
(resumes an interrupted count) and the reusable `EmptyState`/`SkeletonList`/`NoAccess`/
`SessionExpiredDialog` components are genuine additions beyond what the design shows, in the
direction of being *more* robust, not less.

**Made-up numbers:** none found anywhere in the real app — confirmed by code review and by walking
all four roles live. The Step 9/10 "never show a made-up number" rule held.

**True dead ends (reachable, no way out):** none found. Every screen has a working way back —
`AppShell` nav, a back button, or `NoAccess`/`ComingSoonScreen`'s "Go to Home".

**Functional dead end (reachable, but the action itself does nothing):** the Remind flow. An Owner
can open "Remind \<name\>" from a late count, the sheet correctly fetches a real `wa_link` from the
backend, but "Prepare reminder" just closes the sheet and shows a toast — the WhatsApp message is
never actually opened or sent. The person has no way to complete this action at all.

## Walking the flows

Walked all four roles end to end in a real browser against the running app (script written for this
research pass only, not committed — see the commit for what *is* kept). Screenshots of everything
below are in `docs/screens/audit/`.

1. **Home's "Stock count" card only ever reflects the *closing* count's status, never opening's.**
   `mobile/app/home.tsx:383` calls `countStatusLabel(today.closing)` — after the Owner submits the
   opening count, Home still shows "Stock count: Not started" (screenshot:
   `owner-home-with-data.png`), because nothing on that card ever looks at `today.opening`. The Owner
   has no way to tell from Home whether anyone has done anything today.

2. **Manager sees a "Start stock count" quick action, but Manager has no `counts.create`
   permission.** `mobile/app/home.tsx`'s `ActionCard` for "Start stock count" (~line 402) is the only
   one of the three quick actions with no `can(permissions, …)` guard — "Record purchase" and "Record
   wastage" both have one. Tapping it sends a Manager straight into `NoAccess`. Screenshot:
   `manager-home.png`.

3. **The Wastage list's delete-capable row wraps text one character per line.**
   `mobile/app/wastage.tsx:207` places a `<Button>` directly as a sibling inside a `flexDirection:
   'row'` view, alongside the entry's text column (`rowMain`, `flex: 1`). `Button`'s base style is
   `width: '100%'` with no wrapping container constraining it, so it competes for the full row width
   and squeezes `rowMain` to near zero — every word (and often every character) of the item name,
   quantity and reason wraps onto its own line. Only visible for a role with `wastage.delete` (Owner)
   — Manager/Head chef, which never render that button, look fine (`manager-wastage.png` vs.
   `owner-wastage-with-data.png`).

4. **The Record Purchase sheet's "Price per unit" field is clipped off-screen at 390px.**
   `mobile/src/screens/RecordPurchaseSheet.tsx`'s `formGrid` style (~line 371) is
   `{flexDirection: 'row', gap}` with no `flex: 1` on either child `TextField`, and `TextField`'s
   underlying `TextInput` has no `minWidth: 0` (the same class of bug fixed in `/count`'s quantity
   input during Step 10 — see `mobile/app/count.tsx`'s `qtyInput` comment). At 390px the two fields'
   combined natural width exceeds the sheet, and the second one is cut off rather than wrapping.
   Screenshot: `owner-record-purchase-sheet.png`. **`npm run responsive` did not catch this** — its
   overflow check deliberately skips any ancestor with `overflow-x: hidden/clip` to avoid false
   positives on decorative bleed, and that's exactly the kind of ancestor clipping this field. A real
   blind spot in that check, found only by looking at a live screenshot.

5. **Minor, repeated across the app: quantities always show full decimal precision** — "10.000 kg",
   "8.000 kg", "1.000 kg" (`owner-stock-detail.png`, `owner-purchase-detail.png`,
   `owner-wastage-with-data.png`) rather than trimming trailing zeros. Every quantity field is a
   `DecimalField(decimal_places=3)` rendered as-is. Not wrong, just not polished.

Nothing else looked broken, confusing, or inconsistent with the design across all four roles' real
flows (Owner: wizard → purchase → count → stock → wastage → count review → every Coming-soon page;
Manager: Home → Wastage → Buy → Count review; Head chef: Today → Wastage → blocked routes; Helper:
Today → Wastage). Toasts, confirmations and save-landing targets all matched what the design (or the
Step 9/10 specs, where the design is silent) asks for.

## Proposed steps

Ordered so each step's dependencies already exist by the time it starts. One line of scope each,
sized to fit one Claude Code prompt.

1. **Fix the four regressions found in this audit**, plus make "Prepare reminder" actually open the
   `wa_link` it fetches. No dependencies — all in already-shipped screens.
2. **Individual stock/sell item edit and deactivate** (backend: PATCH endpoints on
   `StockItemDetailView` and a new sell-item detail view; a lightweight edit entry point from Stock
   item detail). Foundational for step 3.
3. **Settings screens** — Business details, Brand, What you buy, What you sell, Alert rules — wired
   to `BusinessUpdateView`, `BusinessSettingsView` (both already exist) and step 2's new endpoints.
4. **Team screen** — list (existing `GET team/`), member detail, Reset PIN (new backend endpoint +
   UI), Remove from team (existing `DELETE team/<id>/` + UI).
5. **Sales** — `Sale` model, record/list/summary endpoints, the Sales screen and Record-sales sheet.
6. **Alerts** — an endpoint that actually compares real wastage/purchase/price data against the
   thresholds `BusinessSettings` already stores; Alerts + Alert-detail screens; Home's one hardcoded
   "Needs attention" case becomes a real list. Depends on steps 5 (for sales-linked alerts).
7. **Reports/Trends** — the design's five charts and the biggest-gaps list, on top of steps 5–6's
   data. The sixth chart (Price trend) is already done.
8. **Home dashboard parity** — the "Money today" 4-metric grid and the "Recent activity" feed.
   Depends on steps 5 and 6.
9. **Sales import** — CSV/XLSX upload, column-matching UI, confirm. Depends on step 5.
10. **Account management** — change your own password, forgot-password flow, and a UI for step 4's
    Reset-PIN endpoint if step 4 shipped it backend-only.
