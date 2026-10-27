# Bases, coverage-based gaps and low stock — plan

## 1. Data model

- **`stock.Base`** — a prep item ("onion-tomato masala"). `business` FK, `name` (unique per
  business, like StockItem/SellItem), `unit_family` (weight/volume only — a base is always
  defined per 1,000 g or 1,000 ml), `active`, `created_by`, `created_at`.
- **`stock.BaseIngredient`** — one raw line of a base's batch formula. `base` FK,
  `stock_item` FK (PROTECT, must be non-shared — same rule as `SellItemIngredient`),
  `quantity_per_1000` (decimal, grams/ml per 1,000 g/ml of finished batch). Unique
  (`base`, `stock_item`). Structurally one level only: `stock_item` can never be another
  `Base`, so nesting is impossible by construction, not by a runtime check.
- **`stock.SellItemBase`** — the dish-to-base link, parallel to `SellItemIngredient`.
  `sell_item` FK, `base` FK (PROTECT), `quantity` (grams/ml of the base used per one
  portion, in the base's own batch unit). Unique (`sell_item`, `base`). A dish's full
  recipe is now `ingredients` (direct raw) + `bases` (formula raw) together; either alone
  can make `recipe_status=CONFIRMED` eligible, same "at least one real line" rule as today.
- **`counts.BaseLeftover`** — optional, closing-count-only. `count` FK (StockCount),
  `base` FK, `leftover_qty` (grams/ml). Unique (`count`, `base`). Deliberately **not** read
  by gap.py or any alert — it's a visibility/reference field for the owner only (see
  Decision 4), so it lives as its own small table rather than overloading `CountLine`
  (which is keyed to a `StockItem`, not a `Base`, and whose constraints/serializer assume
  that).
- **`stock.StockItem`** threshold fields: `low_stock_category` (perishable/dry/other,
  defaults from existing `goes_off` at migration time — see Migration below),
  `low_stock_days_override` (nullable int, overrides the category default), `low_stock_fixed_qty`
  (nullable decimal, base unit — wins over the days-of-cover calculation when set). No new
  `BusinessSettings` field; category-default days live as a small constant table
  (`LOW_STOCK_CATEGORY_DEFAULT_DAYS`) next to `gap_alert_pct`'s existing settings pattern.
- **Coverage** is never stored — computed on read in `gap.py`, same spirit as `expected_used`/
  `gap_qty` today.

All new quantities are g/ml (base's own `unit_family`), matching the U1b-1 base-unit system;
`display_quantities` already handles rolling them up for display, nothing new needed there.

## 2. Engine design

**Expansion (one level).** For a stock item, today's `gap_for_line` gathers every
`SellItemIngredient` row pointing at it. New: also gather every `BaseIngredient` row
pointing at it, then for each the set of `SellItemBase` rows using that base. A sale of
dish D expands to: `D`'s direct `SellItemIngredient.quantity` (if any) **plus**, for each
`SellItemBase` row on D using base B that contains this stock item,
`SellItemBase.quantity * (BaseIngredient.quantity_per_1000 / 1000)`. Both contributions sum
if a stock item is reached both directly and via a base (not the case in the Chicken Curry
example, but not excluded). This replaces the single `quantity_by_sell_item_id` map in
`gap_for_line` with a per-(sell_item) expected-quantity-per-portion that already folds in
bases — the rest of `gap_for_line` (sales lookup, `expected_used` sum) is unchanged.

**Coverage.** Per stock item, split the `(sell_item, qty-per-portion)` pairs found above by
the owning sell item's `recipe_status`: `confirmed_expected` = sum of
`units_sold * qty_per_portion` over CONFIRMED sell items in the window; `unconfirmed_expected`
= same sum over UNCONFIRMED ones. `coverage_pct = confirmed_expected / (confirmed_expected +
unconfirmed_expected) * 100`. A `NONE`-status dish has no ingredient/base rows at all, so it
never appears in either sum — its sales are invisible to this per-ingredient figure by
construction (see Decision 5). If the denominator is 0 (no confirmed or unconfirmed recipe
touches this stock item at all), coverage is undefined → same `not_sold`/`recipe_not_confirmed`-
style "not compared" result as today, not a 0%.

Three bands (business-wide constants, not per-business settings — flag if that's wanted later):
`coverage_pct >= 70` → real gap, alert-eligible; `40 <= coverage_pct < 70` → indicative (grey,
no alert); `coverage_pct < 70` and expected usage still comes partly from unconfirmed recipes →
compute against `confirmed_expected` only for display, `< 40` → "not enough recipes yet", not
compared at all (same shape as `recipe_not_confirmed` today, new code
`low_recipe_coverage`).

**Tolerance widening.** `effective_gap_alert_pct = gap_alert_pct * (100 / coverage_pct)` for
`coverage_pct >= 70` (at 100% coverage this is exactly today's `gap_alert_pct`; at 70% it's
~1.43x). Below 70% the line isn't "real" anyway, so no tolerance is computed. See Decision 1.

**Home "Recipes cover X% of your sales".** A separate, business-level (not per-ingredient)
figure: `sum(Sale.amount for sales of CONFIRMED sell items) / sum(Sale.amount for all sales)`
over a rolling window (recommend 30 days, matching `reports/service.py`'s existing periods).
Revenue-weighted, not gram-weighted — see Decision 5; it must stay a separate code path from
per-ingredient coverage, not an aggregate of it.

**Estimated stock now** (for low-stock): `last_count.counted_qty + purchases_since -
wastage_since - expected_used_since`, where `expected_used_since` is the same sales-expansion
function above (coverage-aware: use `confirmed_expected` only, i.e. treat anything below 70%
coverage as 0 contribution to be conservative — never *overstate* available stock). Always
labelled an estimate in the API/UI copy, same framing as the gap figures.

**Where this changes `counts/gap.py`:** `gap_for_line`'s `not_confirmed` block (today: any
non-confirmed dish blocks the whole line) is replaced by the coverage computation above;
`lines_with_gap` is unchanged in shape (still one dict per line), just gains `coverage_pct`,
`gap_tolerance_pct`, and a widened `gap_status`/`gap_reason` vocabulary. A new
`stock/base_expansion.py` (or a function added to `stock/units.py`-adjacent module) owns the
one-level expansion and coverage split, imported by `gap.py`, `alerts/service.py` (low_stock)
and a new low-stock/shopping-list read path, so none of them compute it differently — same
discipline as `unit_cost_for`/`lines_with_gap` today.

## 3. Alert design

- **`low_stock`** — new `ALERT_TYPES` entry. One alert per stock item whose
  `estimated_stock_now < effective_threshold` (fixed qty if set, else
  `days_of_cover * avg_daily_expected_usage`, using the same coverage-aware expected-usage
  function). Severity: `warning` if below threshold, `danger` if `<= 0`. Key:
  `low_stock:{stock_item_id}:{today.isoformat()}` — same daily-reset pattern as
  `wastage_high`.
- **Indicative vs real gap display**: `gap_flagged` only fires (alert + red in count review)
  for `gap_status="ok"` lines with `coverage_pct >= 70` and `flagged=True` (using
  `effective_gap_alert_pct`). `40–70%` lines show in count review as a grey "indicative gap"
  row (same numbers, no alert, no red) — this is a count-detail display rule, not a new
  alert type.
- **Recipients**: `low_stock` alert values (estimated qty, threshold) are visible to anyone
  who can see the alert; its **value in ₹** (cost of the shortfall) is withheld from a
  money-less viewer. See Decision 3 — recommend a dedicated minimal low-stock/shopping-list
  read (no ₹ field) for Head chef rather than opening the general Alerts screen to that role.
- **De-duplication**: same `AlertCheck`-by-key mechanism as every other alert type; no new
  framework needed.
- **Shopping list**: a plain derived list (not stored) — every stock item currently below
  threshold, with `suggested_qty = max(threshold - estimated_stock_now, 0)`, grouped by
  supplier if set. Computed on read from the same low-stock query.

## 4. Permission changes

- New permission `stockitems.thresholds_manage` added to `ALL_PERMISSIONS`. Owner gets it for
  free (computed set); Manager gets it explicitly; Head chef and Helper do not.
- New permission `stock.low_stock_view` (qty/threshold only, no money) added to
  `ALL_PERMISSIONS`, granted to Head chef in addition to Owner/Manager (who already reach the
  same data via `alerts.view`). This is a narrower, dedicated permission rather than widening
  `alerts.view` itself, so the general Alerts screen's money-bearing alert types stay
  Owner/Manager-only exactly as today.

## 5. API and screens needed (list only)

- `GET/POST businesses/<id>/bases/`, `GET/PATCH/DELETE businesses/<id>/bases/<id>/` —
  base CRUD with nested batch ingredients (`stockitems.manage`-equivalent, recommend reusing
  `sellitems.manage` since bases are a recipe concept, not a stock-item one).
- `SellItemCreateSerializer`/`SellItemUpdateSerializer` gain an optional `bases: [...]`
  array alongside `ingredients`.
- `PATCH businesses/<id>/stock-items/<id>/` gains the three threshold fields
  (`stockitems.thresholds_manage`).
- `POST businesses/<id>/counts/<id>/base-leftover/` (closing counts only) — optional, one
  call per base, or folded into the existing count-submit payload as an optional `bases: []`
  array.
- `GET businesses/<id>/stock/low-stock/` — low-stock + shopping list, gated by
  `stock.low_stock_view` (qty-only fields) vs `alerts.view` (full, with ₹) — same endpoint,
  response shaped by caller's permission.
- `alerts/` response gains `low_stock` entries; no new alerts endpoint.
- `GET businesses/<id>/.../home` (or wherever Home's summary lives) gains
  `recipe_coverage_pct`.
- Screens: Settings "Bases" list/add/edit (mirrors `settings/stock.tsx`'s pattern);
  `DishRecipeForm` gains a "use a base" picker next to the raw-ingredient picker;
  `StockItemForm`/`StockItemSheet` gains a low-stock threshold section (category + override +
  fixed qty), Manager/Owner only; closing-count screen (`count.tsx`) gains an optional
  "leftover batches" section; Alerts gets `low_stock` card styling (money hidden for
  Head chef); Home gets a "Recipes cover X% of your sales" banner.

## 6. Test cases that must pass

- **Chicken Curry + base**: base "Onion-tomato masala" = 1,000 g batch (onion 450 g, tomato
  400 g, oil 90 ml, cashew 40 g, spices 20 g). Chicken Curry: 180 g chicken (direct
  ingredient) + 200 g of the base (per portion). Selling 10: chicken 1,800 g (direct),
  base 2,000 g → onion 900 g, tomato 800 g, oil 180 ml, cashew 80 g, spices 40 g (all via
  one level of expansion, confirmed recipe, coverage 100%).
- **Milk regression**: 12,000 ml opening, +20,000 bought, −1,500 wasted, 8,000 counted →
  used 22,500, expected 20,000, gap 2,500 ml = ₹160 = 12.5%, recipe confirmed, coverage 100%
  — must still flag exactly as it does today (tolerance at 100% coverage = today's
  `gap_alert_pct`, unchanged).
- **Coverage 80%** (≥70%): real gap shown, alert-eligible, tolerance widened slightly
  (`gap_alert_pct * 100/80`).
- **Coverage 55%** (40–70%): indicative grey gap shown in count detail, no `gap_flagged`
  alert raised even if the raw gap exceeds the widened tolerance.
- **Coverage 30%** (<40%): "not enough recipes yet", `gap_status="not_comparable"`, no
  numbers shown, same shape as today's `recipe_not_confirmed`.
- **Low stock**: a perishable item (category default 1 day) with `estimated_stock_now` below
  one day's expected usage raises `low_stock`; a dry item (5 days) with the same absolute
  stock level does not.
- **Shopping list**: only items below threshold appear, `suggested_qty` matches
  `threshold - estimated_stock_now`.
- **Permissions**: Manager can set/edit thresholds, Head chef cannot (403); Head chef's
  low-stock read omits ₹ value, Owner/Manager's includes it.

## 7. Migration, risks, decisions

**Migration**: four new tables (`Base`, `BaseIngredient`, `SellItemBase`, `BaseLeftover`),
all empty at creation — fully additive, no backfill of existing recipes (no base exists
until an owner creates one, so every current dish keeps working unchanged via `ingredients`
alone). `StockItem` gains three nullable/defaulted columns; one data migration sets
`low_stock_category` from existing `goes_off` (`True`→perishable, `False`→dry) for every
current row, same shape as the U1b-1 base-unit backfill.

**Risks**:
1. Coverage/expansion adds a second raw-usage path (direct + base) into `gap_for_line`'s
   per-stock-item loop — must stay one query set per count, not N+1 per base, same
   discipline `lines_with_gap` already follows.
2. The tolerance-widening formula and category-day defaults are judgment calls with no data
   behind them yet (Decisions 1–2) — risk of alert fatigue (too loose) or missed real gaps
   (too tight); recommend they ship as constants easy to move into `BusinessSettings` later
   if an owner needs to tune them, not as a user-facing setting on day one.
3. `BaseLeftover` being purely informational (Decision 4) may surprise an owner who expects
   it to correct the gap maths — needs explicit "doesn't affect your gap numbers" copy.
4. Splitting alert visibility (Decision 3) introduces a second "how much can this role see"
   axis beyond the existing `view_all`/`view_value` wastage pattern — small but real added
   complexity to keep straight.
5. Revenue-weighted Home coverage vs gram-weighted per-ingredient coverage (Decision 5) are
   easy to conflate by a future reader of the code; needs a clear docstring split, not just
   a naming convention.

**Decisions needed (max 5), each with a recommendation**:
1. **Tolerance-widening formula.** Recommend `gap_alert_pct * (100 / coverage_pct)` for
   `coverage_pct >= 70`, nothing below — smooth, no extra constant, reduces to today's
   behaviour at 100% coverage.
2. **Category default days.** Recommend perishable=1, dry=5, other=3 (a third bucket for
   anything not cleanly either), inferred from `goes_off` at migration time (perishable iff
   `goes_off=True`), owner-overridable per item via `low_stock_days_override`.
3. **Who sees low-stock without money.** Recommend a new narrow `stock.low_stock_view`
   permission + dedicated endpoint (qty/threshold only) for Head chef, rather than widening
   the general `alerts.view` permission to a role that still can't see any other alert's ₹
   figures.
4. **Where leftover base counts live.** Recommend a standalone `counts.BaseLeftover` table,
   not a nullable `base` column bolted onto `CountLine` (which is structurally keyed to
   `StockItem` and whose uniqueness/serializer assumptions shouldn't be reopened for this).
5. **Revenue vs quantity weighting for "Recipes cover X% of your sales".** Recommend
   revenue-weighted (`Sale.amount`) at the Home/business level (it must include `NONE`-status
   dishes, which have no gram-level expected-usage number at all), kept explicitly separate
   from the gram-weighted per-ingredient coverage used for gap tolerance.

## 8. Sub-step split (engine first, then screens)

1. **Coverage + tolerance engine** (no new models — `gap.py`'s `not_confirmed` block →
   coverage tiers + widened tolerance; Home's revenue-weighted coverage %). Tier 1:
   `npm run verify -- --area counts`. Ships alone — pure behaviour change on an existing
   endpoint, safe with zero bases/thresholds in existence yet.
2. **Bases engine** (`Base`/`BaseIngredient`/`SellItemBase` models + migrations + the
   one-level expansion function, wired into step 1's expected-usage calc; API CRUD only,
   no screens). Tier 1: `npm run verify -- --area stock`. Ships alone — invisible to any
   existing dish until an owner creates a base via the API; zero current recipes affected.
3. **Low-stock thresholds + alert + shopping list** (`StockItem` threshold fields +
   `stockitems.thresholds_manage`/`stock.low_stock_view` permissions + `low_stock` alert +
   shopping-list endpoint). Depends on step 1's coverage-aware expected-usage function;
   does not require step 2's bases to exist. Tier 2 (one screen — the threshold field in
   `StockItemSheet`): `npm run verify:ui -- --area stock --flow <solo-or-chain> --screen
   stock-item-detail`.
4. **Screens**: Bases Settings CRUD, `DishRecipeForm`'s base picker, closing-count leftover
   entry, low-stock/shopping-list screen (or Alerts section), Home coverage banner. Depends
   on steps 1–3 all existing (it's the UI surface for everything above) — largest step,
   likely to need splitting further at execution time into 4a (bases + dish form) / 4b
   (low-stock + count + Home) to stay under 45 minutes each. Tier 2 per sub-part, one flow +
   one screen each.
