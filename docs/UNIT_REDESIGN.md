# Unit redesign — base-unit plan (U1a)

Audit only, no code changed. Written against the state after Step C2c.

## Today vs target

| | Today | Target |
|---|---|---|
| Unit model | `StockItem.unit` is one of 16 flat labels (kg, g, L, ml, piece, pack, dozen, tonne, m, sheet, roll, set, box, bag, tray, bottle) — no family, no conversion. Item is locked to its unit forever once purchased/counted (`stock/views.py:179-184`, `StockItemUnitLocked`). | Every weight item's base unit is **g**; every liquid item's base unit is **ml**. Countables (piece, dozen, sheet, roll, set, m, tray...) keep their own unit as today — no change for those. Packaged units (packet, bag, tin, bottle, box) become an *entry unit* with a pack size, not a base unit. |
| Quantity storage | `DecimalField(max_digits=10, decimal_places=3)` on `PurchaseLine.quantity`, `CountLine.counted_qty`, `WastageEntry.quantity`, `SellItemIngredient.quantity` — always "in the stock item's own unit", whatever that is (kg or L today for the two convertible families). | Same fields, same precision, but the number stored is always grams or ml for weight/liquid items (e.g. "1,500" not "1.5"). 3 decimal places on a gram figure is unnecessary precision owners will never type — plan should drop to 0 (see Decisions). |
| Conversion | None server-side, ever. One client-only g↔kg / ml↔L convert at *ingredient entry* time only (`mobile/src/forms/unitConversion.ts`), nowhere else (not stock-item creation, not purchases, not counts, not wastage). | Conversion happens at every entry point (stock item creation picks a unit *family* + optional pack size; purchases/counts/wastage/recipes all convert typed kg/L/packet/bag/tin/bottle amounts to the base g/ml before saving). Display converts back up to kg/L for large numbers. |
| AI path | `ai/matching.py`'s `_UNIT_FAMILY_BY_UNIT` already maps kg/g/tonne→g, L/ml/bottle→ml, everything else→pieces. `ai/schemas.py IngredientSuggestion.unit` is already `Literal["g","ml","pieces"]`. | Already aligned with the target base units — effectively no AI-path change needed beyond `bottle` moving out of the ml unit-family (bottle becomes a pack-size unit, not a liquid base unit) and accounting for pack-size items generally mapping to their underlying family. |
| Gap maths (`counts/gap.py`) | Pure decimal arithmetic, unit-agnostic — it never looks at what the unit *is*, just subtracts/sums `Decimal`s that are assumed to already be comparable. | No logic change at all — it already works in "whatever the stock item's unit is" terms, which becomes "always grams/ml for that family". This is the best news in the audit. |

## Proposed data model

- `Unit` enum gains a `family` concept, not a code enum change to every value — recommend a small
  `UNIT_FAMILY = {"kg": WEIGHT, "g": WEIGHT, "tonne": WEIGHT, "L": VOLUME, "ml": VOLUME, "bottle": VOLUME, ...}`
  mapping (mirrors `ai/matching.py`'s existing one almost exactly) rather than restructuring the
  choices field itself.
- `StockItem` gets two new fields:
  - `unit_family`: `weight` / `volume` / `count` — derived once at creation from the chosen entry
    unit, stored (not recomputed), since `base_unit` below depends on it and existing per-item
    `unit` lock logic (`has_history` check) should extend to "family can't change" too.
  - `pack_size_base_qty`: nullable `DecimalField` — "1 pack unit = N base units" (e.g. 1 packet =
    500 g). Only meaningful when the chosen entry unit is a pack-style unit (packet/bag/tin/bottle/
    box). Set once, editable only while `pack_size_base_qty` has never been used in a saved
    purchase/count/wastage/recipe row (same "locked after history" pattern as unit today).
- `StockItem.unit` keeps its current meaning but narrows to: the **base unit** the item is actually
  tracked in (`g`, `ml`, or one of the existing non-convertible labels: piece/dozen/sheet/roll/set/
  m/tray/box/bag/tin/bottle used as its own base — e.g. a business that genuinely counts in boxes,
  not weight). `kg`/`L`/`tonne` stop being valid values of `StockItem.unit` going forward (existing
  rows migrate — see below) and become **entry-only** aliases.
- All downstream quantity fields (`PurchaseLine.quantity`, `CountLine.counted_qty`,
  `WastageEntry.quantity`, `SellItemIngredient.quantity`) are unchanged in shape — they still store
  "in the stock item's own unit" exactly as today; that unit is simply always the base unit now.
  Precision: recommend dropping `decimal_places` from 3 to 0 for weight/volume base units (whole
  grams/ml — no restaurant owner measures 1.234 g), but counts tracked in piece/dozen/etc keep 0
  already in practice. Simplest: **keep `decimal_places=3` everywhere, unchanged** — it already
  tolerates whole-gram input fine, and touching precision is unrelated migration risk for no owner
  benefit. (Listed as Decision 4 below in case you disagree.)
- Price: `StockItem.usual_price` and `PurchaseLine.unit_price` stay `DecimalField(max_digits=10,
  decimal_places=2)` but their *meaning* shifts from "price per kg/L/piece" to "price per base unit
  (g/ml/piece)". A price of ₹0.40/g needs 2 decimal places on a per-gram basis (₹400/kg → ₹0.40/g,
  fine) but a cheaper item like ₹0.05/kg flour → ₹0.00005/g **loses all precision** at 2dp. This is
  the single sharpest modelling problem in the whole redesign — see Decision 1.
- Owner-facing price is always **displayed** per kg/L (multiply the per-g/ml stored price by 1000),
  never typed or stored that way.

## Entry and display rules

- **Stock-item creation**: owner picks a unit *family* chip (Weight / Volume / Count-like), then a
  familiar unit to enter in (kg, g, L, ml, or the pack-style units with a one-time "1 X = ___ g/ml"
  prompt). The stored `unit` becomes the base (g or ml) automatically; non-convertible units (piece,
  dozen, sheet...) skip the family step entirely, exactly as today.
- **Every quantity entry screen** (purchases, counts, wastage, recipe ingredient rows): owner keeps
  typing in whatever unit is natural — the existing `entryUnitsFor`/`convertToStockUnit` pattern from
  `unitConversion.ts` (currently ingredient-only) becomes the **one shared conversion helper** used
  by every quantity field in the app, not just the dish form. Packaged items offer "packets" as an
  entry unit too, converting via `pack_size_base_qty`.
- **Display**: any stored amount ≥1,000 (g or ml) displays as kg/L with up to 2 decimals (e.g.
  "1,500 g" → "1.5 kg"); below 1,000 displays as the plain base number ("850 g"). This is a pure
  formatting rule in `format.ts`, parallel to `formatRupees`/`formatIndianNumber` — no new field.
- **Rounding**: entry-time conversion rounds to the nearest whole base unit (gram/ml) before send,
  matching the "no owner types 1.234 g" assumption above.

## Migration plan for existing rows

Current dev DB: 766 stock items (533 `kg`, 199 `L`, 20 `sheet`, 12 `pack`, 2 `piece`), 329 purchase
lines, 563 count lines, 126 wastage entries, 220 recipe ingredient rows — all against `kg`/`L` items
needing conversion; `sheet`/`pack`/`piece` items need none (no production data exists yet — this is
dev/seed data only, per `docs/STATUS.md`, so there is no customer-data risk right now, which simplifies
the real migration but the *script* still needs to be correct for when production data exists).

1. **Backup first** — full DB dump (`pg_dump`/sqlite file copy) before touching anything; keep until a
   full `verify:full` pass confirms the migrated numbers.
2. **Additive migration**: add `unit_family`, `pack_size_base_qty` as nullable/defaulted fields; no
   data change yet. Reversible by dropping the columns.
3. **Backfill migration** (data migration, not schema): for every `StockItem` with `unit in {kg, L,
   tonne}`, multiply every related `PurchaseLine.quantity`, `CountLine.counted_qty`,
   `WastageEntry.quantity`, `SellItemIngredient.quantity` by 1000 (kg→g, L→ml; tonne→g ×1,000,000),
   divide `usual_price`/`unit_price` by the same factor, then rewrite `StockItem.unit` to `g`/`ml`.
   Do this inside one transaction per business (or per stock item) so a failure partway is
   recoverable; log a before/after row count per table for the report.
4. **Order matters**: run stock items' unit+price rewrite and their dependent quantity rewrites in
   the *same* transaction per item — never leave an item's unit changed while its purchase lines
   still reflect the old scale (gap maths would silently corrupt for that window).
5. **Rollback**: since the multiply/divide factor is always a power of 10 recorded in the migration
   itself, the reverse migration is the exact inverse (divide quantities by 1000, multiply prices by
   1000, restore `unit` to kg/L). Keep it as a real Django migration `reverse_code`, not "restore from
   backup" as the only option — but the backup remains the safety net if the reverse migration itself
   has a bug.
6. Non-convertible units (`piece`, `pack`, `dozen`, `tonne`-handled above, `m`, `sheet`, `roll`,
   `set`, `box`, `bag`, `tray`, `bottle`) need **no row changes** — only a `unit_family='count'` (or
   similar) backfill for the new field.

## Files and screens to change

**Backend (grouped by concern):**
- `stock/models.py` (Unit/family mapping, new StockItem fields) — **M**
- `stock/views.py` (unit-lock check extends to family+pack-size lock, price validation) — **S**
- `stock/serializers.py` (new fields, price validation at base-unit scale) — **S**
- Data migration (the backfill above) — **M** (correctness-critical, not line-count-large)
- `purchases/`, `wastage/`, `counts/` serializers/views — likely **no change**, they already just
  store whatever `quantity` arrives; only validation messages referencing "kg" (if any) need a look — **S**
- `ai/matching.py`, `ai/schemas.py`, `ai/prompts.py` — already g/ml/pieces-based; only `bottle`
  leaving the volume family needs a one-line map update — **S**
- `counts/gap.py`, `reports/service.py` — **no change** (unit-agnostic Decimal math, confirmed by audit)

**Frontend (grouped by concern):**
- `src/constants/units.ts`, `src/forms/unitConversion.ts` — becomes the shared conversion module
  (today ingredient-only) — **M**
- `src/forms/StockItemForm.tsx` — unit-family chip, pack-size-once field — **M**
- `src/forms/DishRecipeForm.tsx` — reuse shared conversion (likely shrinks) — **S**
- `src/screens/RecordPurchaseSheet.tsx`, `app/wastage.tsx`, `app/count.tsx` — each gains a unit-entry
  picker + conversion before submit — **M** each (3 screens)
- `app/stock/index.tsx`, `app/stock/[id].tsx`, `app/settings/stock.tsx`, `src/screens/StockItemSheet.tsx` — display formatting (kg/L roll-up) — **S** each
- `app/counts/[id].tsx`, `app/reports.tsx`, `app/alerts/[key].tsx` — gap/report numbers displayed via
  the new formatter only — **S** each
- `src/sectorCopy.ts`/`.json` (`allowedUnits`/`defaultUnit`) — defaults shift to g/ml-family choices — **S**
- `src/format.ts` — new `formatBaseQuantity(value, family)` helper — **S**
- `src/screens/StarterStockPicker.tsx`, `app/setup/3.tsx` — starter-pack items' units need re-checking
  against new defaults — **S**

No screen needs a full rewrite; this is wide (≈20 files) but shallow (**M** at worst per file) except
the migration itself and the shared conversion module, which carry the real risk.

## Regression cases (in base units)

- **Milk** (base unit ml): opening 12,000 ml, +20,000 ml bought, −1,500 ml wasted, 8,000 ml counted →
  used = 12,000 + 20,000 − 1,500 − 8,000 = 22,500 ml. Expected: 100 tea packs × 200 ml = 20,000 ml.
  Gap = 2,500 ml = ₹160 (at ₹0.064/ml, i.e. ₹64/L) = 12.5% of expected — same percentages as today's
  spec, now computed in ml throughout with no conversion step inside `gap.py` at all.
- **kg-bought, gram-used item** (e.g. Rice, base unit g): owner buys "25 kg" → stored as 25,000 g at
  entry; a dish recipe line uses "150 g" per portion → stored as 150 (no conversion needed, already
  the base unit). Confirms the two entry paths (bulk kg purchase, small-g recipe line) land on the
  same scale without drift.
- A **non-convertible item** (e.g. Sheet pans, 20 sheets) must show byte-identical behaviour before
  and after — proves the migration correctly leaves family="count" items untouched.

## Risks and decisions needed (max 6)

1. **Price precision at gram/ml scale.** `max_digits=10, decimal_places=2` on price-per-base-unit
   loses precision for cheap-per-kg items (flour, rice) once rebased to per-gram. *Recommendation*:
   widen `usual_price`/`unit_price` to `decimal_places=4` (₹0.0005 granularity per gram = ₹0.50/kg
   granularity, plenty) — a schema change but a safe, purely-additive one (more decimal places, not
   fewer).
2. **Pack-size field placement.** Could live on `StockItem` (one pack size per item, simplest, matches
   "set once") or as a separate small table (supports multiple pack sizes per item, e.g. both 500 g
   and 1 kg packets of the same flour). *Recommendation*: one field on `StockItem` — matches the
   spec's "set once" framing and every other per-item setting's pattern (`shelf_life_days`, etc.);
   revisit only if an owner actually asks for multiple pack sizes per item.
3. **Does the unit-lock rule extend to family/pack-size, or just the base unit?** Today only `unit`
   itself is locked after history exists. *Recommendation*: lock `unit_family` and `pack_size_base_qty`
   the same way once any history exists — changing either retroactively would silently rescale every
   past row's meaning.
4. **Quantity decimal_places: keep at 3 or drop to 0 for weight/volume?** *Recommendation*: keep 3,
   unchanged — no owner benefit to touching it, and it avoids one more migration dimension.
5. **`tonne` and `bottle` reclassification.** `tonne` folds into the weight family (scale ×1,000,000
   to g) and `bottle` moves from "its own thing" to a **pack-style entry unit** for volume items
   (since `ai/matching.py` already treats it as `ml`-family) rather than staying a flat label.
   *Recommendation*: confirm `bottle` should always imply a `pack_size_base_qty` prompt (e.g. "1
   bottle = 1,000 ml"), same as packet/bag/tin/box when used on a liquid item.
6. **Is this worth doing with zero production data today?** Since the current DB (766 items) is dev/
   seed data only, the migration script's *correctness* still matters (it'll run for real eventually)
   but there's no actual data-loss risk right now. *Recommendation*: still build and test the
   migration properly in U1b rather than treating it as throwaway, since real owner data starts
   accumulating the moment this ships.

## Proposed U1b split (≤45 min each)

1. **U1b-1 — Backend model + migration** (schema fields, backfill migration, unit-lock extension,
   price decimal-places widening). No API/serializer behaviour change yet beyond what the migration
   requires. **Tier 1**: `npm run check` + `npm run verify -- --area stock`.
2. **U1b-2 — Backend entry/validation + shared frontend conversion module** (serializers accept
   entry-unit + pack-size at creation; `unitConversion.ts` promoted to the shared helper used by
   purchases/counts/wastage, not just recipes). **Tier 1**: `verify -- --area stock` +
   `verify -- --area counts` + `verify -- --area purchases`.
3. **U1b-3 — Screens: entry pickers + display roll-up** (StockItemForm, RecordPurchaseSheet, count.tsx,
   wastage.tsx, stock list/detail, reports/alerts display formatting). **Tier 2**:
   `verify:ui -- --area stock --flow wizard --screen settings-stock` (plus a second targeted
   `verify:ui` pass for counts if time allows within the 45 minutes).

## Report

- **Biggest finding**: the redesign is far less invasive than it looks — `counts/gap.py` (the gap
  maths) and the AI path (`ai/matching.py`/`schemas.py`) are *already* unit-family-aware and need
  effectively zero logic changes; conversion already exists in miniature (`unitConversion.ts`), just
  scoped to one screen instead of shared.
- **Size**: **M overall** (≈20 files touched, mostly shallow); riskiest part is the price-precision
  problem (Decision 1) and getting the backfill migration's per-item transaction boundary right so no
  item is ever left half-converted.
- **Decisions needed from you**: the 6 above — most load-bearing are #1 (price decimal places) and
  #5 (tonne/bottle reclassification).
- **Branch/merge status**: `step-29u1a-unit-plan` created, this doc committed and merged to `main` per
  CLAUDE.md's git workflow. No code or data touched. Time taken: ~20 minutes.
