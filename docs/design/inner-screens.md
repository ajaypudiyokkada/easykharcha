# EasyKharcha — inner screens (post-login)

Text-only information architecture for the screens an owner sees after setup: Home plus the six daily
jobs (record a purchase, count stock and wastage, record or import sales, see where money is going,
fix problems, manage team and settings). No visual design yet — layout, components and exact copy
come later, reusing the approved kit and the patterns already built in sign-up/login/setup.

Sample data throughout ("Fresh Paneer", "₹4,200") is made up for illustration only.

---

## 1. Screen inventory

Kept to nine screens. Several jobs share a screen on purpose (counting and wastage are one flow;
recording and importing sales are one screen with two entry methods) so the owner isn't hunting
across near-duplicate places to do one job.

| Screen | Question it answers | Who can open it | Main action | Daily job(s) |
|---|---|---|---|---|
| **Home** | How is my business doing right now? | Owner, Manager, Head chef, Helper (content differs — see §8) | Context-dependent — the day's most useful next step | Entry point to all |
| **Stock** | What do I have, and what do I need to buy or count? | Owner, Manager, Head chef, Helper | "Record purchase" (Owner/Manager) or "Start count" (all) | 1, 2 |
| **Record Purchase** | What did I just buy, and what did it cost? | Owner, Manager | Save purchase | 1 |
| **Count Stock** | What do I actually have, and what did I lose? | Owner, Manager, Head chef, Helper | Save count | 2 |
| **Sales** | What did I sell? | Owner, Manager | Record sale / Import sales | 3 |
| **Reports** | Where is my money going, and is anything leaking? | Owner, Manager (all reports); Head chef (operational reports only — no prices) | Varies per report — mostly "view details" | 4 |
| **Alerts** | What needs fixing right now? | Owner, Manager, Head chef | Mark as fixed / tap through to the detail | 5 |
| **Team** | Who works here, and what can they do? | Owner, Manager | Add team member | 6 |
| **Settings** | How do I want EasyKharcha to behave? | Owner, Manager | Save settings | 6 |

**Merges already made:** stock item detail (price history, supplier, usage) lives inside Stock as a
drill-down, not its own top-level screen. Report detail views (charts, drill-downs) live inside
Reports the same way. Wastage is a field inside Count Stock, not a separate screen — job 2's own
wording ("count... and record wastage") already treats it as one flow.

---

## 2. Navigation

**Mobile — bottom bar, 5 items max:** Home, Stock, Sales, Reports, More.
**More contains:** Alerts, Team, Settings, Log out.

| Role | Bottom bar | Inside More |
|---|---|---|
| Owner | Home, Stock, Sales, Reports, More | Alerts, Team, Settings, Log out |
| Manager | Home, Stock, Sales, Reports, More | Alerts, Team, Settings, Log out |
| Head chef | Home, Stock, Reports, More | Alerts, Log out (no Team/Settings) |
| Helper | Home, Stock | *(no More — nothing else to reach)* |

Sales is dropped for Head chef and Helper (neither handles money); Reports is dropped for Helper
(no price/profit visibility). Alerts stays under More rather than in the main five because Home
already surfaces the top 2–3 alerts directly — the full list is a deeper look, not a daily habit.

**Desktop:** the same items become a persistent left-hand side menu with labels always visible (not
icon-only). There's no "More" fold on desktop — there's room, so Alerts/Team/Settings/Log out just
sit as additional entries lower in the same menu, in the same order they'd appear inside More on
mobile. Role differences (Head chef's shorter menu, Helper's two-item menu) carry over unchanged.

---

## 3. Home — blocks, in order

| # | Block | Tells the owner, in one line |
|---|---|---|
| 1 | Brand header (existing) | Whose business this is |
| 2 | Finish setting up (existing, only if a step was skipped) | What's left before setup is complete |
| 3 | Today's alerts (top 2–3, if any) | What needs attention right now |
| 4 | Today so far (sales / purchases / wastage, small numbers) | How today is going |
| 5 | Quick actions (Count stock, Record purchase, Record sale) | What to do next |
| 6 | This week's money leak (one line + trend arrow) | Whether money is leaking this week |
| 7 | Log out (existing) | — |

Block 3 only appears when there's something to say; block 2 only appears mid-setup. A fully set-up,
alert-free day sees blocks 1, 4, 5, 6, 7 — five blocks, still short and scannable.

---

## 4. Reports and trends

| Report | Question (plain words) | Chart | Periods | One action | Who |
|---|---|---|---|---|---|
| Where your money went | What did I spend on, and how much? | Stacked bar, by stock item | Week / Month / Custom | Tap a bar → the purchases behind it | Owner, Manager |
| The leak | Did I use what I should have, based on what I sold? | Bar — "used" vs "should have used" per item, gap called out | Week / Month | Tap an item → its count/wastage history | Owner, Manager, Head chef |
| Wastage over time | Is wastage going up or down? | Line (or bar for short periods) | Day / Week / Month | Tap a point → that day's wastage entries and reasons | Owner, Manager, Head chef |
| Purchase prices rising | Is anything costing more than it used to? | Line, per item | Month / 3 months | Tap an item → its price history and supplier | Owner, Manager |
| Sales vs cost | What am I making on each thing I sell? | Bar, selling price vs stock cost per item | Week / Month | Tap an item → its pricing detail | Owner, Manager |
| Today's snapshot | How's today compared to usual? | A number with a small trend arrow | Today vs yesterday / Today vs last week | Tap through to the full report behind it | Owner, Manager (a plainer, price-free version for Head chef) |

**Expiry alerts are coming soon** — shown as a greyed-out "Expiry alerts (coming soon)" row inside
Reports/Alerts, not a working feature yet. No POS or accounting integrations are claimed anywhere;
"Import sales" means uploading a file the owner already has, nothing more.

---

## 5. Button rules

1. **One primary button per screen.** If a screen seems to need two, one of them is secondary or text.
2. **Labels are a verb plus the thing**, never "Submit", "OK" or "Continue" alone — "Record purchase",
   "Save count", "Add team member". The label says what happens, not that something happened.
3. **Primary** = filled pill, brand colour, one per screen, the thing the screen exists for.
   **Secondary** = outlined pill, a real but lesser action ("Import sales" next to "Record sale").
   **Text/link** = underlined text, low-weight actions ("View details", "Edit", navigation).
4. **On mobile, the primary button sits in the sticky bottom bar**, same pattern as setup — never
   buried at the bottom of a long scroll.
5. **Destructive actions are labelled exactly** ("Delete item", "Remove team member" — never just
   "Delete") **and always confirmed** with a plain-language question naming the thing: "Delete Fresh
   Paneer? This can't be undone." Confirm button repeats the verb ("Delete"), not "Yes".
6. **Loading:** the button keeps its label, shows a small spinner in place of the icon/text start, and
   disables itself — so the owner knows it's working, not frozen, and can't double-submit.
7. **Disabled:** visually dimmed, and the reason is visible nearby (a hint or inline error), never a
   silently-dead button.
8. **After a save:** a short success message (e.g. "Purchase recorded") and the owner lands back on
   the screen that started the action (Stock after Record Purchase, Count Stock's own screen after
   Save, etc.) — never dropped somewhere unrelated like Home.

### The 15 most important buttons

| Label | Screen | Kind |
|---|---|---|
| Record purchase | Stock | Primary |
| Save purchase | Record Purchase | Primary |
| Start count | Stock / Home | Primary |
| Save count | Count Stock | Primary |
| Record sale | Sales | Primary |
| Save sale | Record Sale form | Primary |
| Import sales | Sales | Secondary |
| Add stock item | Stock | Secondary |
| Add team member | Team | Secondary |
| Save settings | Settings | Primary |
| Mark as fixed | Alerts | Secondary |
| View details | Reports cards | Text |
| Delete item | Stock item detail | Danger |
| Remove team member | Team | Danger |
| Log out | Home / More | Secondary |

---

## 6. Empty states (new owner, no data yet)

| Screen | Message | Button |
|---|---|---|
| Home | "Nothing recorded yet today." | Count stock |
| Stock | "No purchases recorded yet." | Record a purchase |
| Count Stock | "No counts yet — start with today's opening count." | Start count |
| Sales | "No sales recorded yet." | Record a sale |
| Reports | "Not enough data yet — record a few purchases and sales to see your reports." | Record a purchase |
| Alerts | "No issues right now — nice work." | *(no button — a good state needs no action)* |
| Team | "It's just you right now." | Add a team member |

Record Purchase, Sales' entry form and Settings are forms, not lists — they don't have an empty state.

---

## 7. Decisions needed (with recommendation)

| # | Decision | Recommendation |
|---|---|---|
| 1 | Can Head chef see Sales, or only operational screens? | No — Head chef sees Reports (read-only, price-light) but not Sales entry; money handling stays Owner/Manager. |
| 2 | Can Head chef record purchases? | No — purchases involve paying suppliers; keep to Owner/Manager. |
| 3 | What does "Import sales" actually accept? | A CSV upload the owner already has (from their billing/POS), nothing live-connected — no integration claims. |
| 4 | Does Helper see stock prices while counting? | No — blind counts: name, unit, current level only. No usual price, no supplier. |
| 5 | Does "the leak" and "wastage over time" need Head chef access? | Yes — they're the one counting; seeing the pattern helps them count better. Keep Head chef's version price-free (quantities and gaps, not ₹). |
| 6 | Is "Mark as fixed" on an alert a plain dismiss, or does it need a note? | Plain dismiss for v1; an optional note can come later if owners ask for it. |
| 7 | One Settings screen or split (business profile vs alert thresholds)? | One screen, two clearly labelled sections — keeps the screen count down, matches "keep it short". |
| 8 | Does Alerts belong in the main 5 nav items instead of More? | Keep it under More — Home's top-alerts block already covers the "glance" case; promote it later only if owners say they can't find it. |

---

## 8. Role variants

The Owner's version of every screen above **is** the full version described in §1–§6 — nothing is
hidden or simplified for Owner. Manager gets the same full version as Owner throughout (no variant
needed). Only Head chef and Helper differ, and only where it actually matters:

**Hidden entirely (screen not in nav, not reachable):**

| Role | Hidden screens |
|---|---|
| Head chef | Sales, Team, Settings |
| Helper | Sales, Reports, Alerts, Team, Settings |

**Need a genuinely different version (not just hidden):**

| Screen | Head chef's version | Helper's version |
|---|---|---|
| Home | Drops the money/leak blocks; keeps alerts (wastage/count ones only), today's counts, quick actions | Greeting + "have I counted today?" status + one button: Count stock. Nothing else. |
| Stock | Same list, but item rows show name/unit/current level only — no usual price, no supplier (price-light, not fully blind) | Fully blind: name, unit, current level only |
| Count Stock | Same as Owner's | Same form, but the item list it's counting from is the blind Stock view above |
| Reports | Operational reports only (the leak, wastage over time), price-free versions of each | *(not reachable)* |

That's the whole variant set — two screens get a genuinely different version per role, everything
else is either the full Owner/Manager version or not shown at all.
