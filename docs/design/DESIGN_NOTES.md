# Design notes — inner screens prototype

Compact text equivalent of `docs/design/easykharcha_inner_screens_role_state_extended.html`.
Read this instead of the HTML from now on. Every id, field, and button label below is copied
verbatim from the source file; "Roles" and "Empty/Error/Offline" are derived from its
`permissions` map and `applyState()`/`applyRole()` logic, not guessed.

## Legend (shared behaviour, not repeated per screen)

**Roles** in the prototype's role switcher: Owner, Manager, Head chef, Helper. Head chef and
Helper never see the Owner/Manager screens below — `go('home')` and `go('wastage')` silently
redirect them to `role-today` / `role-wastage` instead, and any other Owner/Manager screen name
redirects to `screen-no-access`.

**Empty / Loading / Error** only cycle (via the prototype's State selector) on 7 screens —
`home`, `buy`, `stock`, `reports`, `sales`, `alerts`, `team` — called out below as "stateScreens".
Every other screen only ever shows Normal or Offline.
- Loading: 3 shimmering skeleton cards (same shape everywhere).
- Error: "We couldn't load this" / "Please try again." → button **Try again** (back to Normal).
- Empty: screen-specific copy + action button — see each screen's row.

**Offline** (any screen, not just stateScreens): a banner — "You're offline. Changes can't be
saved right now." — appears under the top bar. Any Save button click while offline shows an
inline error with the same text instead of saving.

**Save failed** (prototype "Fail next save" control, any sheet/dialog's primary Save button):
first click shows inline "We couldn't save this. Your changes are still here." and relabels the
button **Try again**; the next click succeeds normally.

**Session expired** (prototype "Expire session" control): opens `sessionDialog` regardless of
current screen.

**No access**: `screen-no-access` — "You don't have access to this." / "Ask the owner." →
**Go to Home**. This is what any disallowed screen redirects to, not a screen reached by nav.

**Nav chrome**: `bottom-nav` (phone, Owner/Manager) has Home/Stock/Buy/Reports + **More** (opens
`moreSheet`). `role-bottom-nav` (phone, Head chef/Helper) has only Today/Wastage. `desktop-side`
(≥840px) lists every permitted item directly, no "More". Avatar button (top right, every
Owner/Manager screen) has no handler — decorative in the design itself.

**Prototype-only controls** (floating gear button, bottom right): Role select, State select,
"Fail next save", "Expire session". Not part of the real app — simulate the behaviour documented
above.

## Screens

### `screen-home` — Home
| | |
|---|---|
| Purpose | Daily dashboard: greeting, today's 4 task tiles, money-today metrics, top stock gap, recent activity, needs-attention alerts, quick actions |
| Fields | none (read-only) |
| Buttons | 4 task tiles — Purchases, Stock count, Wastage, Sales (→ their screens) · **Reports** link · **See all gaps** link · **All alerts** link · 4 alert rows — Closing count is due / Milk price is up / Milk has a 3 L gap / Flour wastage is high (→ alert-detail) · Quick actions — **Record purchase**, **Start stock count**, **Record wastage**, **Record sales** |
| Roles | Owner, Manager (Manager: no Wastage tile, no Start-stock-count/Record-wastage quick actions) |
| Empty | "Start with three simple jobs." + 3 first-step cards: **Record purchase**, **Start stock count** (Manager: **View stock** → Home), **Record sales** |

### `screen-buy` — Purchases
| | |
|---|---|
| Purpose | Purchase list + today/7-day/suppliers summary strip |
| Fields | Search input, placeholder "Search purchases" |
| Buttons | Filter icon button (aria-label "Filter purchases", no handler — dead in the design) · **View** per purchase card (→ purchase-detail) · **Record purchase** (opens `purchaseSheet`) |
| Roles | Owner, Manager |
| Empty | "No purchases yet." → **Record purchase** |

### `screen-stock` — Stock
| | |
|---|---|
| Purpose | Stock-due banner, start/review actions, Current/Past tabs, stock item list |
| Fields | Search input, placeholder "Search stock" |
| Buttons | **Start stock count** (Owner only, opens `countSheet`) · **Review today's counts** (Owner and Manager both, → count-review) · Tabs **Current stock** / **Past counts** (client-side only) · Filter icon button (aria-label "Filter stock", dead) · 4 stock rows — Milk, Flour, Cooking oil, Rice (→ stock-detail) |
| Roles | Owner, Manager (Manager: no Start-stock-count) |
| Empty | "No stock counts yet." → Owner **Start stock count**, Manager **Go to Home** |

### `screen-reports` — Reports
| | |
|---|---|
| Purpose | Period picker + 6 charts |
| Fields | Period chips — Today / 7 days (default) / 30 days / 3 months (client-side only) · Stock-item select inside the price chart |
| Buttons | Chart 1 "Where money went" (stacked bar, tap/hover tooltip) → **View purchases** · Chart 2 "Milk used vs what it should have used" (grouped bar, tooltip) → **Review milk gap** · Chart 3 "Wastage over time" (line, tooltip) → **View wastage** · Chart 4 "Purchase prices rising" (line + item picker, tooltip) → **View purchases** · Chart 5 "Sales vs cost" (dual line, tooltip) → **View sales** · Chart 6 "Biggest gaps" (2 rows: Milk, Cooking oil → stock-detail, no separate button) |
| Roles | Owner, Manager |
| Empty | "Reports will appear after you record purchases, stock counts and sales." → **Record purchase** |

### `screen-sales` — Sales
| | |
|---|---|
| Purpose | Today's sales summary + record/upload actions + today's sales list |
| Fields | none |
| Buttons | **Record sales** (opens `salesSheet`) · **Upload sales report** (→ sales-upload) · list rows are static, no per-row button |
| Roles | Owner, Manager |
| Empty | "No sales yet." → **Record sales** |

### `screen-sales-upload` — Upload sales report
| | |
|---|---|
| Purpose | 3-step wizard: choose file → check & match → done. Reached only via Sales' "Upload sales report", not in any nav |
| Fields | Step 1: radio "Petpooja report (Excel)" / "Other file (CSV or Excel)", file input (`.csv,.xls,.xlsx`). Step 2: 2 "match to" selects for unmatched item names ("Masala Tea Lg", "Combo Snack 2") — options Tea pack / Snack box / Sweet pack / Skip |
| Buttons | **Check file** (step 1→2) · **Confirm upload** (step 2→3, disabled until every match row is answered; shows "Match or skip every unmatched item before confirming." while disabled) · **View sales** (step 3, → Sales) |
| Roles | Owner, Manager |
| Empty/Error/Offline | not a stateScreen |

### `screen-wastage` — Wastage (Owner)
| | |
|---|---|
| Purpose | Today/7-day wastage summary + record + recent wastage list |
| Fields | none |
| Buttons | **Record wastage** (opens `wasteSheet`) · **View** per entry (link, no handler — dead end, no wastage-detail screen exists) |
| Roles | **Owner only** — Manager has no "wastage" in its permission set (hidden from nav entirely). Head chef/Helper use the separate `role-wastage` screen instead |
| Empty/Error/Offline | not a stateScreen |

### `screen-alerts` — Alerts
| | |
|---|---|
| Purpose | Filterable alert list; a late-count card is the one actionable alert |
| Fields | Filter chips — All 4 / Counts / Prices / Wastage / Gaps (decorative, not wired) |
| Buttons | Late-count card: **Remind Meena** (opens `remindSheet`), **Count it myself** (opens `countSheet`; hidden for Manager) · 3 alert rows — Milk price increased / Milk has an unexplained gap / Flour wastage is above your limit (→ alert-detail) |
| Roles | Owner, Manager |
| Empty | "Nothing needs your attention right now." → **Go to Home** |

### `screen-alert-detail` — Alert detail
| | |
|---|---|
| Purpose | One alert's heading/text/number pairs + primary action |
| Fields | none (read-only) |
| Buttons | Primary action — label and destination vary by alert: **Start stock count** (→ stock), **Review milk price** / **Review milk gap** (→ stock-detail), **View flour wastage** (→ wastage) · **Mark as checked** (→ Alerts with a toast, no real persistence) |
| Roles | Owner, Manager |
| Empty/Error/Offline | not a stateScreen |

### `screen-purchase-detail` — Purchase detail
| | |
|---|---|
| Purpose | One purchase's supplier/total/date + line items |
| Fields | none (read-only) |
| Buttons | **Edit purchase** (Owner only, reopens `purchaseSheet` pre-filled) · **Delete purchase** (Owner only, opens `deleteDialog`) |
| Roles | Owner (full), Manager (view-only — sees "Only the owner can edit or delete." instead of the two buttons) |
| Empty/Error/Offline | not a stateScreen |

### `screen-stock-detail` — Stock item detail
| | |
|---|---|
| Purpose | Current amount/gap/latest price + last 4 counts + price-trend chart (tap/hover tooltip) |
| Fields | none (read-only) |
| Buttons | **Record purchase** (opens `purchaseSheet`) · **Record wastage** (opens `wasteSheet`; hidden for Manager) |
| Roles | Owner, Manager |
| Empty/Error/Offline | not a stateScreen |

### `screen-team` — Team
| | |
|---|---|
| Purpose | List of team members |
| Fields | none |
| Buttons | **Add team member** (Owner only, opens `teamAddSheet`) · 4 member rows — Anita Rao/Owner ("You" chip), Vikram Kumar/Manager, Rahul Singh/Head chef, Meena Patil/Helper (→ member-detail) |
| Roles | Owner (full), Manager (view-only, no Add) |
| Empty | "No team members yet." → Owner **Add team member**, Manager **Go to Home** |

### `screen-member-detail` — Team member detail
| | |
|---|---|
| Purpose | One member's mobile/role/access |
| Fields | none (read-only) |
| Buttons | **Reset PIN** (Owner only, opens `resetPinDialog`) · **Remove from team** (Owner only, opens `removeMemberDialog`) |
| Roles | Owner (full), Manager (view-only — sees "Only the owner can change team access." instead) |
| Empty/Error/Offline | not a stateScreen |

### `screen-settings` — Settings
| | |
|---|---|
| Purpose | Grouped settings rows: Business (Business details, Brand) · Stock & sales (What you buy, What you sell, Alert rules, Expiry alerts) |
| Fields | none |
| Buttons | 6 setting rows → setting-detail. "Expiry alerts" shows a **Coming soon** chip instead of a chevron, same 44px tap target |
| Roles | **Owner only** — Manager has no "settings" permission, nav item hidden entirely |
| Empty/Error/Offline | not a stateScreen |

### `screen-setting-detail` — Setting detail
| | |
|---|---|
| Purpose | Placeholder list of fields already collected during setup, for one settings group |
| Fields | Group-specific placeholder fields, e.g. "What you buy" → Stock item name, Unit, Usual price, Supplier, Used in many items, Goes off, Shelf life |
| Buttons | **Save changes** (hidden entirely for the "Expiry alerts" group, which is Coming soon) |
| Roles | Owner only |
| Empty/Error/Offline | not a stateScreen |

### `screen-role-today` — Today (Head chef / Helper)
| | |
|---|---|
| Purpose | Role-specific home: greeting, 2 big actions, deadline card, today's entries |
| Fields | none |
| Buttons | **Count stock** (→ blind-count) · **Record wastage** (→ role-wastage) |
| Roles | Head chef, Helper only — this is what `home` redirects to for them. Head chef sees "Entries today" / the team's entries; Helper sees "My entries today" / only their own |
| Empty/Error/Offline | not a stateScreen |

### `screen-blind-count` — Count stock (blind)
| | |
|---|---|
| Purpose | Per-item blind quantity entry — no expected value or gap shown |
| Fields | Per item (Milk, Flour, Cooking oil in this prototype): quantity input (aria-label "`<item>` quantity"), **Not sure** checkbox, **Skip for now** button (becomes "Skipped" once clicked) |
| Buttons | Per-item **−** / **+** steppers (aria-label "Decrease/Increase `<item>`") · **Save count** (disabled until every item is counted or skipped; shows "Count or skip the remaining items before saving." while disabled) |
| Roles | Head chef, Helper |
| Guard | Typing a value ≥75 opens `blindGuardDialog` before it's accepted |
| Empty/Error/Offline | not a stateScreen |

### `screen-blind-saved` — Count saved
| | |
|---|---|
| Purpose | Confirmation after a blind count save — "Count saved. Thank you." / "You can't change this after saving. Tell the owner if something is wrong." |
| Buttons | **Back to Today** (→ role-today) |
| Roles | Head chef, Helper |

### `screen-role-wastage` — Wastage (Head chef / Helper)
| | |
|---|---|
| Purpose | Record-wastage form + "My entries today" list (prepends locally on save, prototype only) |
| Fields | Stock item (select) · How much (input) + Unit (select) · Reason (select) · Note (optional, input) |
| Buttons | **Save wastage** |
| Roles | Head chef, Helper |
| Empty/Error/Offline | not a stateScreen |

### `screen-count-review` — Today's counts
| | |
|---|---|
| Purpose | List of today's counts + one static detail panel (gap items first) + recount action |
| Fields | none |
| Buttons | 2 count-review cards — Closing count · Meena Patil (late by 40 min), Opening count · Rahul Singh (on time) — **tapping either just scrolls to the same static detail panel below, a design bug, not per-count data** · **Review biggest gap** (→ stock-detail Milk) · **Ask for a recount** (opens `remindSheet`, which is titled "Remind Meena" regardless of which count was tapped — another design bug) |
| Roles | Owner, Manager |
| Empty/Error/Offline | not a stateScreen |

### `screen-no-access` — No access
| | |
|---|---|
| Purpose | Shown whenever a role's own `go()` call targets a screen outside its permission set |
| Buttons | **Go to Home** |
| Roles | reachable by any role, for any disallowed screen |

## Sheets

### `moreSheet` — More
| | |
|---|---|
| Purpose | Overflow nav (phone width only) |
| Buttons | Close (X) · 5 menu rows — Sales, Wastage, Alerts, Team, Settings (→ their screens; each hidden for Manager if outside Manager's permission set — Settings always hidden for Manager) |
| Roles | Owner, Manager (Head chef/Helper use `role-bottom-nav` instead — 2 items, no More) |

### `purchaseSheet` — Record purchase / Edit purchase
| | |
|---|---|
| Purpose | Same sheet reused for both create (Quick action / Buy screen) and edit (Purchase detail's "Edit purchase") |
| Fields | Stock item (select: Milk/Flour/Cooking oil/Rice) · How much + Unit (2-col row) · Price per unit + Total paid (2-col row) · Supplier (text) |
| Buttons | Close (X) · **Save purchase** → toast "Purchase saved. You are back in Purchases." → Buy |
| Roles | Owner, Manager (edit trigger is Owner only) |

### `countSheet` — Closing stock count
| | |
|---|---|
| Purpose | Owner/Manager's own stock-count sheet (distinct from Head chef/Helper's `screen-blind-count`) — shows expected value and gap, unlike the blind form |
| Fields | Per item (Milk, Flour shown — "3 of 24 shown in this prototype"): **−**/**+** stepper only (no free-typed box), status chip ("Check" / "Looks right"); Milk has an Owner-only inline explain note: "Owner view: system expected about 11 L. Current gap is 3 L." |
| Buttons | Close (X) · **Save count** → toast "Stock count saved. You are back in Stock." → Stock |
| Roles | Owner, Manager |

### `wasteSheet` — Record wastage (Owner)
| | |
|---|---|
| Fields | Stock item (select) · How much + Unit (2-col row) · Reason (select: Spillage/Spoiled/Over-prepared/Damaged/Other) |
| Buttons | Close (X) · **Save wastage** → toast → Wastage |
| Roles | Owner (Wastage itself is Owner-only); also opened pre-filled from Stock item detail's "Record wastage" |

### `salesSheet` — Record sales
| | |
|---|---|
| Fields | Date (date input) · Item sold (select) · How many + Total (2-col row) |
| Buttons | Close (X) · **Save sales** → toast → Sales |
| Roles | Owner, Manager |

### `teamAddSheet` — Add team member
| | |
|---|---|
| Fields | Name · Mobile · Role (select: Manager/Head chef/Helper) · PIN or password (password input), with inline note "We won't show this PIN or password again after you save it." |
| Buttons | Close (X) · **Add team member** → toast → Team |
| Roles | Owner only |

### `remindSheet` — Remind `<name>`
| | |
|---|---|
| Purpose | Prepares a reminder message for a late count. Title is static "Remind Meena" regardless of who triggered it — a design bug, not per-person data |
| Fields | none — just a message preview: "Hi Meena, the closing stock count is still pending. Please complete it when you can." |
| Buttons | Close (X) · **Prepare reminder** → toast "Reminder ready to send. You are back on Home." → Home |
| Roles | Owner only — triggered from Alerts' "Remind Meena" and Count review's "Ask for a recount" |

## Dialogs

### `deleteDialog` — Delete purchase?
| | |
|---|---|
| Fields | none; subtitle shows supplier + total |
| Buttons | Close (X) · **Delete purchase** (danger) → toast → Buy · **Keep it** (cancel) |
| Roles | Owner only |

### `resetPinDialog` — Reset PIN?
| | |
|---|---|
| Buttons | Close (X) · **Reset PIN** → toast → member detail · **Keep current PIN** (cancel) |
| Roles | Owner only |

### `removeMemberDialog` — Remove from team?
| | |
|---|---|
| Buttons | Close (X) · **Remove from team** (danger) → toast → Team · **Keep member** (cancel) |
| Roles | Owner only |

### `blindGuardDialog` — "That looks very different from usual."
| | |
|---|---|
| Purpose | Unusual-value guard on the blind count screen (`screen-blind-count` only — the Owner/Manager `countSheet` has no equivalent guard) |
| Buttons | Close (X) · **Yes, `<value>` `<unit>` is right** (dynamic label) · **Let me fix it** (closes, refocuses the input) |
| Roles | Head chef, Helper |

### `sessionDialog` — "You've been logged out"
| | |
|---|---|
| Purpose | "Your session has expired." No close/X — can't be dismissed except by its own button |
| Buttons | **Log in again** |
| Roles | any (prototype-only trigger, "Expire session" control) |
