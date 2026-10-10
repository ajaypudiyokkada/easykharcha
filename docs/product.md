# EasyKharcha — Product Spec v3.1 (end-to-end build)

**Product:** EasyKharcha (India brand; *Effresto* is the reserved non-Indian brand — ⚠ AP to confirm which name the purchased .com/.ai/.in domains map to, and whether the app UI carries one brand or both). **First tenant / pilot:** FOMO restaurant, with its own tenant branding (Teak #B19461, Nepal #8EABC1). Every tenant can carry its own logo and colours inside the EasyKharcha product shell.

> **v3.1 change summary (from two owner requirement recordings, Oct 2026).** (1) Gram-level recipes return as an **optional, per-dish** feature (§5b) — the owner's core question is "did what we bought get sold or accounted for?", which needs expected-vs-actual quantity. (2) New **Variance report** with unexplained-loss alerts. (3) **Segregation of duties** made explicit: blind stock counts, soft flag when one person records both stock and sales (§1b). (4) **Sales import** from a POS report (Petpooja CSV first; API unverified) (§5c). (5) **Invoice photo** attached to a purchase; auto-extraction is phase 2. (6) Structured **wastage reasons**. (7) **Role-specific home dashboards**. (8) **Business-type neutrality** (restaurant / homestay / etc.) in naming. v3 is preserved as `product_v3.md`. Items marked ⚠ need AP's decision.

Status: multi-tenant role/workflow design **validated** in a working browser artifact (https://claude.ai/artifact/LL2kB18fEKV9AD7nRTc8Wn) with FOMO as the pilot. This spec is now the brief for the real build: Django REST + React Native (web-first, native-ready). The prototype (`docs/reference/FOMO_App.html`, whose `LOCAL` backend object is the authoritative reference implementation) for every business rule below — where this document and that code could ever disagree, the code is what was actually tested.

## 0. Why a rebuild, and why React Native

The artifact proved the workflow (roles, daily stock, misc-cost allocation, corrections) with real use, but it runs on claude.ai's platform: everyone needs a claude.ai account with Contributor access, there's a document-size ceiling, no custom domain, no offline support. The real build removes all of that:

- **Backend:** Django REST Framework + PostgreSQL, deployed the same way as `liveprojectstatus` (DigitalOcean, Docker, nginx, Let's Encrypt) — a pattern this team already runs in production.
- **Frontend:** React Native, written to run three ways from one codebase — **react-native-web** for the mobile-web MVP (what staff actually use day to day, no install needed), and native iOS/Android builds compiled from the same components once the MVP is validated. This matches the plan: ship mobile web first, compile to native later without a rewrite.
- **Auth:** phone + PIN as today, backed by Django's auth with JWT (access + refresh tokens), not claude.ai identity.

## 1. Roles and permissions

| Capability | Staff | Head Chef | Manager | Owner | Super Admin |
|---|---|---|---|---|---|
| Add wastage | ✅ | ✅ | ✅ | ✅ | ✅ |
| Capture opening/closing stock (daily) | — | ✅ | ✅ | ✅ | ✅ |
| Receive goods (purchase + vendor + qty, one step) | — | ✅ | ✅ | ✅ | ✅ |
| Request inventory | — | ✅ | — | ✅ | ✅ |
| Record sales (plates per dish, per day) | — | — | ✅ | ✅ | ✅ |
| **Add** ingredient / dish / vendor | — | — | ✅ | ✅ | ✅ |
| **Edit or delete** ingredient / dish / vendor / pricing config | — | — | — | ✅ | ✅ |
| Manage staff (add/deactivate, assign role per restaurant) | — | — | — | ✅ | ✅ |
| Grant **Super Admin** to another user | — | — | — | — | ✅ (only a Super Admin can grant it; always ≥1 must remain active) |
| Add a new restaurant | — | — | — | ✅ | ✅ |
| Edit restaurant branding / thresholds / SLA | — | — | — | ✅ | ✅ |
| View Reports / Trends | — | — | — | ✅ | ✅ |
| **Edit or delete any saved entry** (wastage/stock/purchase/sale/request), audit-logged | — | — | — | ✅ (own restaurants) | ✅ (any) |
| View audit log | — | — | — | ✅ (own restaurants) | ✅ (any; toggle "this restaurant" / "all restaurants") |

**Rule of thumb, validated end to end:** anyone with the right role can *create* a record; only Owner/Super Admin can *edit or delete* one afterward, and every edit/delete is written to the audit log with before/after values. Staff/Manager/Head Chef entries are otherwise append-only — corrections go through Owner, not re-editing.

## 1b. Segregation of duties (v3.1)

The owner's requirement: *one person must not control both the inventory numbers and the sales numbers.* Implementation:
- **Blind counts.** Staff/Head Chef stock and wastage screens never show sales, expected usage, variance, or a system-computed closing figure. (Showing "expected closing" invites fudging the count to match.) Closing still shows today's purchases inline, as before, for the impossible-count guard only.
- **Chef cannot record sales** (already true in the matrix; keep). Sales come from the Manager, or from an import of the POS report (§5c).
- **Soft flag, not hard block:** if the same user recorded DailyStock (open or close) *and* Sales for the same date, the Report shows a "same person recorded stock and sales on <date>" flag. Hard-blocking would break 2-person restaurants and Owner-operated ones; Owner/Super Admin entries are exempt from the flag. ⚠ AP: flag-only (recommended) vs. hard block per-restaurant setting.
- **Role dashboards (Home tab):** Staff/Head Chef → today's capture tasks and SLA status only. Manager → sales entry/import status, open requests, short deliveries. Owner/Super Admin → today's alerts + week-to-date cost%, top variances, SLA misses. Nav is already role-filtered; this adds a landing screen per role.

## 2. Restaurant & user model (as built)

- **Users**: `phone` (login id, unique), `name`, `pin`, `active`. One identity regardless of how many restaurants a person touches.
- **Access**: grants a `(phone, role)` pair at a specific `restaurant_id` — or `restaurant_id = '*'` for a **global** Super Admin grant. A multi-restaurant Owner holds one Access row per restaurant. Super Admin status is a role on an Access row, not a separate flag, which is what let the app support *promoting* a second Super Admin from inside Admin → Staff, with a server-enforced "at least one must remain" guard and a self-demotion guard.
- Login: one restaurant → straight in. More than one (multi-restaurant Owner, or Super Admin) → a restaurant picker, with "Switch" always available after.
- Every operational table is scoped by `restaurant_id`; a Manager at one restaurant cannot see or act on another's data even if both exist in the same system.
- **Super Admin bootstrap**: the system ships with exactly one seeded Super Admin account; all further restaurants, staff and role grants are created through the app by a Super Admin or Owner — there is no setup wizard that auto-creates a restaurant for whoever logs in first.

## 3. Data model (field-level, from the validated implementation)

**Restaurant**: `id, name, tagline, logo_url, primary_colour, accent_colour, status(active/inactive), default_target_pct, waste_alert_pct, rate_creep_pct, sla_hours, count_day` **+ v3.1:** `business_day_cutoff_hour` (default 4 — orders before this hour count toward the previous business date), `timezone` (default `Asia/Kolkata` — POS timestamps carry no offset)

**DishAlias** (v3.1, per restaurant): `dish, pos_name, normalised, plate_multiplier` — a POS item name mapped to a dish. `plate_multiplier` lets "Chilli Chicken (Half)" count as 0.5 plates of the full dish instead of needing a duplicate dish with its own recipe. Unique on (restaurant, normalised).

**Ingredient** (per restaurant): `code, name, category, unit, rate, vendor, target_pct, waste_alert_pct, shared(Y/N), track(Y/N), notes` **+ v3.1:** `canonical` (global ingredient tag, nullable), `piece_weight_g` (nullable), `recipe_unit` (e.g. `g`, `ml`, `pc`), `recipe_units_per_stock_unit` (e.g. 1000 g per kg; default 1), `yield_pct` (usable fraction after trimming/cooking loss, default 100), `variance_alert_pct` (optional per-ingredient override)
— `shared = Y` marks a misc/overhead ingredient (oil, spices, packaging) not tied to one dish; see §5.

**Dish** (per restaurant): `code, name, section, price, ing(primary ingredient code), active, notes` **+ v3.1:** `pos_alias` (the item name as it appears in the POS export, for import matching)
— validated constraint: a dish's primary ingredient **cannot** be one flagged `shared` — enforced both in the picker and server-side.

**Vendor** (per restaurant): `code, name, category, contact, phone, terms, gst, notes`

**DailyStock** (per restaurant, per ingredient, per date): `date, ingredient_code, opening_qty, opened_by, opened_at, closing_qty, closed_by, closed_at`
— opening pre-fills from the previous day's closing; a non-Owner can capture each of opening/closing exactly once per day (a second attempt throws, deliberately — correction is an Owner action). Closing is capped: it cannot exceed opening + that day's purchases (an "impossible count" guard).

**Purchase** (= "Receive goods", one step): `date, vendor_code, ingredient_code, qty_invoiced, rate, amount, invoice_ref, qty_received, received_by, received_at, request_id` **+ v3.1:** `invoice_image` (optional photo of the bill, stored; viewable from the entry and the Audit view)
— `qty_received` vs `qty_invoiced` mismatch is a **short-delivery alert**.

**Wastage**: `date, ingredient_code, qty, reason, entered_by, entered_at` — **v3.1:** `reason` becomes a fixed list (`Spoilage`, `Trim/prep loss`, `Staff meal`, `Spill/damage`, `Returned/rejected`, `Other` + free-text note required for Other) so the report can show *where* waste comes from.

**Sale**: `date, dish_code, plates, revenue, entered_by, entered_at` — revenue auto-fills from menu price × plates, editable for discounts. **v3.1:** `source` (`manual` | `import`), `import_batch` (nullable), `channel` (dine-in / takeaway / aggregator, carried so reports can split it later; nothing branches on it yet).
— imported `revenue` is **net of discount, excluding tax and all charges**: cost% is measured against food sales, not tax collected.

**RecipeLine** (v3.1, per dish): `dish_code, ingredient_code, qty_per_portion` (in the ingredient's `recipe_unit`). A dish with ≥1 line is a *recipe dish*. Constraints: ingredient must be **non-shared** (shared/misc ingredients stay pooled per §5 — oil, salt, masalas, sauces are never given gram recipes); unique (dish, ingredient). `dish.ing` stays required and should equal the dish's main recipe line.

**RecipeTemplate / RecipeTemplateLine** (v3.1, global, see §5d): `code, name, cuisine, category, portion_label, pieces_per_portion` / `canonical, qty_per_portion, unit, basis, size_multipliers, confidence`. `RecipeLine` gains `source_template` (nullable) and `confidence`.

**SalesImport** (v3.1): `id, date_range, filename, uploaded_by, uploaded_at, rows_total, rows_matched, rows_unmatched` **+** `format_key` (which parser read it), `file_hash` (sha256 of file + format + range, so confirming twice is a no-op) — one row per uploaded POS report. The uploaded file itself is never stored.

**Request** (inventory request, Head Chef → Manager/Owner): `date, ingredient_code, qty, note, requested_by, status(open/fulfilled), fulfilled_purchase_id` — auto-fulfilled when a purchase is entered referencing it, or marked manually.

**Audit**: `at, restaurant_id, user, action, detail` — every create/edit/delete writes here; PINs are never written to it.

## 4. SLA & daily-capture alerts

Computed live (not a stored cron job in the artifact; the Django version should run this as both an on-demand computation **and** a scheduled job for push/WhatsApp alerts — see §8):
- **Closing-stock SLA**: if yesterday's closing stock for a tracked ingredient is still missing once `sla_hours` have passed since local midnight, surface a high-severity alert.
- **Opening-stock SLA**: same pattern at `sla_hours / 2` for today's opening.
- **Open inventory requests**, **short deliveries**, **cost-over-target**, **waste-over-threshold**, and **rate-creep** (purchase rate >10% over the ingredient's standard rate) all surface the same way.
- These render as a banner on every entry screen (Wastage/Stock/Receive/Sales), not just in Reports.

## 5. Dish costing: primary + misc (validated formula)

For a date range `[start, end]`:
1. For each **non-shared** ingredient: `consumed = opening + purchases − closing − wastage`; `cost = consumed × weighted_avg_purchase_rate` (falling back to the ingredient's standard rate with zero purchases in range). `cost% = cost / sales_of_dishes_using_this_ingredient`.
2. For each **shared** ingredient: same consumption/cost math, but pooled into `totalSharedCost` rather than attributed to one ingredient's dishes.
3. Per dish: `primaryCost = ingredientCost × (dishRevenue / revenueOfAllDishesSharingThatIngredient)`; `miscCost = totalSharedCost × (dishRevenue / totalRevenueAllDishes)`; `estCost% = (primaryCost + miscCost) / dishRevenue`.

This needs no recipe/gram data entry — it gets more accurate automatically as real oil/spice/packaging purchases accumulate.

## 5b. Recipes & variance — expected vs actual (v3.1, optional per dish)

Why: the owner's question is "if we bought 5 kg boneless chicken and a portion is 150 g, did we sell ~33 portions, or is the rest in recorded wastage?" Revenue-share costing (§5) cannot answer this; quantity reconciliation can. Recipes are **optional per dish** so a restaurant adopts them gradually; dishes without a recipe keep §5 behaviour unchanged.

For a range `[start, end]` and each **tracked, non-shared** ingredient `I`:
```
actual_used  = opening + purchased - closing          # total disappearance, INCLUDING wastage
expected     = sum over recipe dishes d with line (d, I):
                 plates_sold(d) * qty_per_portion / recipe_units_per_stock_unit / (yield_pct/100)
wastage      = sum(wastage.qty)                       # recorded by chef
unexplained  = actual_used - expected - wastage       # >0 = missing stock; <0 = over-reported / recipe too generous / count error
unexplained_value = unexplained * weighted_avg_rate
unexplained_pct   = unexplained / expected
```
(Note: the §5 `consumed` figure = `actual_used − wastage`, so `unexplained = consumed − expected`.)

**Coverage rule (important):** variance for `I` is only trustworthy if every dish with sales in range that uses `I` has a recipe containing `I`. A dish counts as *using* `I` if it has a recipe line for `I`, or (no recipe) its primary `ing` is `I`. If any such dish lacks a recipe, mark `I` **"incomplete recipes"**, show the coverage % (revenue of covered dishes ÷ revenue of all dishes using `I`), and **suppress the alert** — don't cry wolf on a half-configured ingredient.

**Alert:** `abs(unexplained_pct) > variance_alert_pct` (ingredient override, else restaurant default) and coverage = 100% → "Unexplained loss/gain on <ingredient>: <qty> (₹<value>)". Positive and negative both alert; negative usually means a wrong recipe or a miscount.

**Dish costing with recipes:** a recipe dish's primary cost = `Σ qty_per_portion × weighted_rate ÷ yield` per plate × plates (a true standard cost), plus `miscCost` allocated from the shared pool exactly as §5. Non-recipe dishes unchanged. The Report shows both *standard cost%* (from recipe) and *actual cost%* (from stock movement) side by side for recipe dishes — the gap is the efficiency number the owner called "kitchen efficiency".

**Kitchen efficiency score (Owner dashboard):** `1 − Σ|unexplained_value| ÷ Σ(actual_used value)` over covered ingredients, shown as a single weekly trend. ⚠ AP: label/definition to confirm with the owner.

**Recipe entry UX:** Admin → Dishes → Recipe tab: add ingredient lines with grams per portion; show live standard cost per plate and margin vs price. Add-recipe is Manager+, edit/delete is Owner/SA (same create-vs-edit split as other config).

**Worked example (seed this):** Boneless chicken, stock unit kg, recipe unit g (1000/kg), yield 100. Chilli chicken 150 g/plate; noodles 30 g; soup 30 g. Bought 5 kg, opening 0.5, closing 0.8, wastage 0.3 kg, sold 20 chilli chicken + 10 noodles + 6 soup → expected = (20×150 + 10×30 + 6×30)/1000 = 3.48 kg; actual_used = 4.7 kg; unexplained = 4.7 − 3.48 − 0.3 = **0.92 kg** (≈26% of expected) → alert.

## 5d. Recipe template library (v3.1)

Goal: a new restaurant should get working recipes in minutes by *adopting* a template and adjusting grams, never by starting from a blank screen.

**Concepts**
- **Canonical ingredient** — a global tag on each tenant Ingredient (`canonical`: e.g. `CHICKEN_BONELESS`, `CHICKEN_WINGS`, `PORK_RIBS`, `FISH_STEAK`, `PANEER`, `BASMATI_RICE`). Set during ingredient creation (dropdown with "none/other"). This is what lets one global template apply to every tenant's differently-named ingredients ("Chicken curry cut" vs "Curry cut chicken").
- **Template** (global, Super Admin-managed; tenants can't edit globals): `code, name, cuisine, category, portion_label, pieces_per_portion (optional), lines[]` where each line = `canonical, qty_per_portion, unit (g/ml/pc), basis` (`weight` or `piece`) and optional `size` variants (`half` / `full` / `family`, as multipliers).
- **Piece-based portions:** many menus sell "6 pcs". Template stores `pieces_per_portion` and the canonical's `avg_piece_weight_g`; qty = pieces × piece weight unless a fixed weight is given. Tenant can override the piece weight per ingredient (`piece_weight_g` on Ingredient) since cuts differ by supplier.
- **Adopt flow** (Admin → Dishes → Recipe → "Start from template"): search/browse templates → pick → app maps each template line to the tenant's ingredient with the matching `canonical` (if several, ask; if none, offer to create) → shows editable grams, live standard cost per plate and margin vs the dish price → save as normal RecipeLines. Adopting **copies** the numbers; later template updates never silently change a tenant's recipes (optional "template has updated — review" prompt).
- **Size variants:** a dish sold as Half/Full maps to one template with a multiplier, or two dishes; keep to the multiplier to avoid duplicate menu items.
- **Bulk adopt:** during onboarding, "match my menu to templates" — suggest a template per dish by name similarity, owner confirms in one pass.

**Calibration (the important part — template grams are starting points, not truth):**
- Each template line carries `confidence` (`owner_stated` | `typical` | `calibrated`) and the UI labels them. Only values an owner actually stated or a restaurant measured count as `calibrated`.
- **Weigh-in prompt:** after adopting, ask the chef to weigh one finished portion's raw input once and enter it (one-time, 30 seconds); this overrides the template for that tenant.
- **Implied-portion suggestion:** for an ingredient used by a single dish, `implied_g = (actual_used − wastage) ÷ plates` over a week. If it differs from the recipe by more than the variance threshold, suggest "your recipe says 150 g; your kitchen is actually using ~185 g — update recipe or investigate?" Owner decides; never auto-edited (it would hide real loss).
- **Cross-tenant learning (later, opt-in):** anonymised, aggregated implied-portion data across clients can refine global `typical` values. ⚠ needs client consent terms before building.

**Seed content for launch:** start small and honest — only what the FOMO owner stated (chilli chicken 150 g boneless = 6 pc-ish; noodles/soup 30 g chicken) as `owner_stated`, plus ~30–50 common Indian restaurant dishes (chicken/mutton/fish/paneer starters, biryanis, fried rice/noodles, curries) as `typical` values authored by FOMO's chef and validated against the first two or three clients before wider release. I'm deliberately not shipping a made-up gram table as if it were fact: wrong defaults would produce false variance alerts and destroy trust in the report. ⚠ AP: who owns authoring/validation of the starter library — FOMO's head chef?

## 5c. Sales import (v3.1)

The owner already has per-dish sales in Petpooja and could not make Petpooja's own inventory/recipe module accurate. The product's position: **we reconcile physical counts against sales; we do not try to maintain a perpetual system inventory.**
- **MVP:** Manager+ uploads the POS item-wise sales report (CSV/XLSX: date, item name, quantity, amount). Server matches rows to dishes by `pos_alias` then exact name; shows a preview (matched / unmatched / suggested match); on confirm writes `Sale` rows with `source=import`. Re-uploading the same date range replaces that range's *imported* rows only (manual rows untouched) and logs to Audit. Unmatched items are listed and can be mapped once (saving `pos_alias`).
- **Approved formats (registry of parsers):** (1) **Generic CSV/XLSX** — built, the fallback any POS can reach. (2) **Petpooja item-wise report** — pending the export; see [`docs/imports/petpooja_orders_master.md`](imports/petpooja_orders_master.md) for why the Orders Master Report could not be used (it is order-level and carries no item names or quantities). Adding a POS = one parser class + fixture + test. The Import screen has a source dropdown with auto-detect by header signature, a reconciliation line (parsed total vs the file's own total), and an unmatched-items mapper. Fuzzy matching only ever *suggests*. New tenant settings: `business_day_cutoff_hour` (default 4), `timezone` (default Asia/Kolkata). Confirm is idempotent on a hash of (file + format + range). Uploaded files and customer columns are never stored.
- **Phase 2 (⚠ unverified):** direct Petpooja API sync. I have not confirmed Petpooja offers a public API for third parties or its terms; confirm with Petpooja before promising it to clients. Same import path can serve other POS exports (Posist, Torqus, generic CSV).
- **Phase 2:** invoice photo → auto-fill purchase lines (OCR/vision). MVP stores the photo only.

## 6. Reports, Trends, Audit

- **Report**: Owner/Super Admin only, arbitrary date range (defaults to the current week), per-ingredient and per-dish tables, **Variance table (v3.1: expected, actual, wastage, unexplained qty/₹, coverage, sorted by ₹ loss), wastage-by-reason breakdown, segregation flags**, alerts for the range, a "Share summary to WhatsApp" action (`wa.me` deep link — still the integration point; see §8 for why).
- **Trends**: last N weeks of cost% per ingredient + total, computed as N independent report() calls over weekly windows.
- **Audit**: Owner sees their own restaurant(s); Super Admin gets a "this restaurant / all restaurants" toggle.

## 7. Screens (all built and tested in the artifact; port 1:1)

Home (role dashboard, v3.1) · Wastage · Daily Stock (open/close, shows same-day purchases inline) · Receive Goods (+ fulfil an open request) · Requests (raise + fulfil) · Sales · Sales Import (v3.1) · Admin (tabs: Ingredients, Dishes **(+ Recipe sub-tab, v3.1)**, Vendors, Staff, each schema-driven — see `ADMIN` object in the prototype's `LOCAL` backend object (`docs/reference/FOMO_App.html`)) · Report · Trends · Audit · Restaurant Settings · Restaurant Picker / Add Restaurant (with "pre-fill from FOMO's starter data" option) · PIN change.

Every list screen that holds corrigible entries (Wastage, Stock, Receive, Sales, Requests) shows inline **Edit / Delete** controls, visible only to Owner/Super Admin.

## 8. Explicitly deferred (unchanged from v2, now with a build note)

- ~~Gram-level recipes~~ — **now in scope as optional (§5b)** after owner feedback. Still deferred: recipes for *shared* ingredients (oil, masalas, salt), sub-recipes/batch prep (gravies, stocks), stock transfers between outlets, returns-to-vendor, and stock-correction entries.
- **WhatsApp automation** — Meta's Cloud API group limits still apply (8 participants, business-created groups only); the Django version should add outbound alerts via a BSP (Gupshup/Interakt/Twilio) as a proper integration, since a real backend can run scheduled jobs and hold API credentials that an artifact cannot.
- **POS API integration** — CSV/XLSX import is in scope (§5c); direct API sync deferred and unverified.
- **Offline support** — not in the artifact at all; worth scoping for the React Native build once native compilation is underway, since restaurant wifi is exactly the kind of place this matters.

## 9. Beyond restaurants (v3.1 note)

The owner noted the same buy → process → sell pattern fits homestays (e.g. Coorg), cloud kitchens, bakeries. Cheap prep now, no extra product: name the model `Business` in code (UI label from `business_type`: "Restaurant"/"Homestay"/…), and label `Dish` as "Menu item / Product" in the UI. Defer vertical-specific features (room-nights, guest counts as the sales driver) until a real homestay client asks. ⚠ AP: rename `Restaurant`→`Business` in the backend now (cheap) or keep and rename later (migration pain).

## 10. Product, brand and domains (v3.1)

- Product name **EasyKharcha** (India). **Effresto** reserved for non-Indian markets. Domains purchased: .com, .ai, .in — ⚠ mapping to names unconfirmed. Suggested plan once confirmed: one primary domain serves the app (`app.<primary>`) and marketing site, the others 301-redirect; email on the primary.
- Tenant branding (logo, colours, tagline) is per-restaurant and shown inside the app; the EasyKharcha mark appears in the shell/footer ("Powered by EasyKharcha").
- Open (user-side): trademark search in India (classes 9 and 42), social handles, registrar WHOIS confirmation.
