# Repo map

One line per item. Current as of Step 16. Backend API prefix on every endpoint below: `/api/v1/`.

## Backend apps (backend/)

- `accounts/` — signup, login, refresh, logout, /me; models.py (User), serializers.py (`SignupSerializer`'s `business_name` — Step F2), otp.py (OTP, unused by UI yet), ratelimit.py (IP/mobile rate limits), validators.py (PIN/password rules), views.py (`SignupView` creates the User and, Step F2, their one Business — name only — in one transaction via `businesses.creation.create_business`), urls.py
- `audit/` — one audit-log row per write; models.py (AuditLog), log.py (log_action helper), no endpoints
- `businesses/` — business CRUD, onboarding, team, settings, permissions; models.py (Business — Step 21b added `pincode`/`state`/`country`, kept `city`; Step F2 made `business_type`/`city` `blank=True` (filled in by the wizard, not at signup); Step O1 added `onboarding_path` (`""`/`quick`/`diy`, `OnboardingPath` choices) for the onboarding fork; Access, AccessRole), creation.py (Step F2's `create_business` — Owner access, onboarding rows, default settings; shared by `SignupView` and `BusinessCreateView`), views.py (`BusinessUpdateView` — Step 23: a `business_type` change with existing items and no `items_action` raises `ItemsDecisionNeeded`), sector_change.py (Step 23's `remove_items_for_sector_change`, keeping items with history or still used by a sell item), team.py, business_settings.py, permissions.py (the role→permission table — Step 23a: `ALL_PERMISSIONS` registry, Owner computed as all of it), access.py (access_or_403/owner_access_or_403), colour.py (brand-colour contrast), serializers.py (`validate_pincode_location`, shared by create/update; `BusinessUpdateSerializer`'s `items_action`), urls.py
- `geo/` — Step 21b: India pincode lookup; models.py (Pincode — pincode/area/district/state/office_type, indexed on pincode), states.py (`INDIA_STATES`), management/commands/load_pincodes.py (idempotent CSV load, `--if-empty` for entrypoint.sh), views.py, exceptions.py (PincodeNotFound), urls.py
- `config/` — Django project config; settings.py, urls.py (root router), exceptions.py (DRF error-shape handler), views.py (health), wsgi.py
- `counts/` — blind stock counts, today status, count review, reminders; models.py (StockCount —
  Step 23b's `missing_opening`, CountLine), views.py (`CountsTodayStatusView`'s `counts/today/`;
  `CountListCreateView.post` raises `OpeningRequired` for a closing with no opening unless the
  opening was missed, and never marks a business's first-ever count late — Step 23d), business_day.py
  (`business_date_for` — Step 23b's `day_starts_hour` shift, counts/alerts' `opening_late`/
  `closing_late` only, not sales/wastage/reports/purchases; Step 23d's `has_any_count` gates the
  first-count framing and suppresses missed-opening/late-count logic until it's true), today_status.py
  (`status_for`'s locked/due/late/done + `next_action` + `is_first_count`, shared with `today/`),
  serializers.py, gap.py (Step 14's stock-gap math, shared with alerts/ — Step 23d's `_local_date`
  matches sales by each count's plain local calendar date, not its shifted business_date), config.py
  (unusual-value guard constants, `CLOSING_GRACE_HOURS`), exceptions.py (`OpeningRequired`), urls.py
- `purchases/` — purchase CRUD, suppliers; models.py (Purchase, PurchaseLine — Step U1b-1 widened
  `unit_price` to 4dp/12 digits, a per-base-unit price now), views.py, serializers.py, exceptions.py, urls.py
- `stock/` — stock items, dishes (SellItem); units.py (Step U1b-1: `UnitFamily`
  (weight/volume/count), `UNIT_FAMILY`/`unit_family()` — kg/g/tonne->weight, L/ml->volume, bottle
  and everything else->count; frozen separately inside the backfill migration, not imported by it);
  models.py (StockItem, SellItem — Step 19 added `group`; Step U1b-1 added `unit_family` and
  `pack_size_base_qty` (never locked by history, unlike `unit`/`unit_family` — see
  StockItemDetailView.patch) and widened `usual_price` to 4dp/12 digits (a per-base-unit price now,
  not per-kg/L);
  Step 22's `Unit` has 16 pure-label choices, no backend conversion between any of them; Step 22a
  replaced `main_stock_item`/`uses_qty` with `SellItemIngredient` (one row per ingredient, qty
  always in the stock item's own unit) and added `portion_label`/`recipe_status`
  (none/unconfirmed/confirmed — gap.py, reports/service.py and sector_change.py only trust
  `confirmed`)), views.py (`SellItemListView.post` is the single dish create with ingredients,
  always confirmed, 400 if none valid; `SellItemDetailView.patch` same rule when `ingredients` is
  sent; `sell-items/bulk/` stays ingredients-free, recipe_status=none, `skip_existing` — Step 22a2:
  every manual UI create/edit now goes through the single, ingredient-required endpoints; bulk is
  only the starter-pack tick list and a future menu-upload flow), serializers.py
  (`SellItemCreateSerializer`/`IngredientRowSerializer`), exceptions.py (Step F4: `TooManyRows`'s
  message now names the actual configured cap), urls.py.
  Step C2a built the choice screen and a bulk-create-without-ingredients caller (`mobile/app/
  menu-scan/`, below). Still unbuilt: `RecipeStatus.UNCONFIRMED` and `DishRecipeForm`'s `stepLabel`/
  `onSkip` card-flow props, for Step C2b's guided ingredients pass.
  Step U1b-1: migrations `0006_base_units`/`0007_backfill_base_units` rebase every existing kg/L/
  tonne stock item (and its purchase/count/wastage/ingredient rows) onto g/ml, reversibly
  (`manage.py migrate stock 0005` to undo — see that migration's docstring for its one known
  reverse-precision gap: a tonne-origin item, none exist in dev data today, would reverse as if
  kg-scale); `management/commands/verify_u1b1_base_units.py` proves the Milk and kg-bought/
  gram-used regression cases against real seed data (rolled back, nothing persisted).
  Step 41b1b3a: `low_stock.py` (`estimated_stock_now`, `effective_threshold`, `low_stock_rows` —
  shared by alerts/service.py's new `low_stock` type and `LowStockListView`); `StockItem` gained
  `low_stock_category`/`low_stock_days_override`/`low_stock_fixed_qty` (migrations 0009-0010).
  Step 43b1c2a: `estimated_stock_now`'s usage subtraction now covers unconfirmed recipes too (not
  confirmed-only), flagging `partly_unconfirmed` rather than hiding it — threaded through
  `low_stock_rows`/`LowStockListView`/the `low_stock` alert.
- `wastage/` — wastage entries; models.py (WastageEntry — Step U1b-1 widened `unit_cost_at_entry`
  to 4dp/12 digits, matching `usual_price`), views.py, serializers.py, urls.py
- `sales/` — manual sales entries (one row per sell item per business date); models.py (Sale), views.py, serializers.py, exceptions.py, urls.py
- `alerts/` — Step 15: alerts computed on read (opening_late/closing_late — Step 23b's split of the
  old count_late, price_rise, wastage_high, gap_flagged, Step 18's expiry_soon, Step 41b1b3a's
  low_stock — daily-keyed, text carries no money), never scheduled;
  models.py (AlertCheck), service.py (compute_alerts/open_alerts), views.py, serializers.py, urls.py
- `reports/` — Step 16: the six Reports blocks computed on read, no models; service.py (summary_for — reuses counts/gap.py's lines_with_gap/unit_cost_for for every gap figure; Step U1b-3b-2: wastage_trend's `quantity_by_family` via stock/units.py's `report_group_key`/`display_quantities` — weight/volume share one fungible bucket, everything else its own one-member bucket; used_vs_expected/biggest_gaps display-converted too), views.py, urls.py
- `ai/` — Step C1/C1b/C1c/C1d/C1e/C2a/C2c: menu reading + recipe suggestions via Anthropic (provider/ —
  fake.py for AI_FAKE with realistic token counts, anthropic_provider.py for real (no `temperature`
  kwarg —
  anthropic 2.x's Messages.create dropped it; `tool_choice_for_model`'s `_MODELS_REQUIRING_AUTO_TOOL_CHOICE`
  set — Step C1e: claude-sonnet-5-5 rejects a forced tool_choice since it defaults to adaptive
  thinking, so it gets `{"type": "auto"}` + a system line forcing the tool instead, retried once if no
  tool_use block comes back), base.py's run_with_fallback shared by both, now also carrying a
  `truncated`/max_tokens flag and logging (no raw content) when the primary model's output fails
  validation); models.py
  (MenuScan, AiUsage, AiRecipeCache — keyed by prompt_version too), schemas.py (pydantic validation —
  dish `kind`/`note`/`variants` (price-like variants rejected — Step C2a: a bare number needs 3+
  digits to count as a price, so a dish-style suffix like "Gobi Manchurian/65"'s "65" survives),
  recipe `ingredients`<=7/`minor_ingredients` (Step C2a: `DishRecipeSuggestion.dish_name` also accepts
  a `name` alias, Haiku's occasional slip, without triggering run_with_fallback's retry), 400-dish
  cap, merge_menu_results for PDF chunks), limits.py (daily per-business caps + the monthly cost cap,
  all Decimal), files.py (temp upload storage, deleted after each job),
  extraction.py (Step C1d: `run_menu_extraction` — the one chunk/call/merge/incomplete pipeline,
  shared by jobs.py and scripts/ai_try_menu.py; retries an overflowing chunk one page at a time before
  giving up), jobs.py (process_menu_scan calls extraction.run_menu_extraction then records usage/
  saves the scan, stamps each dish `existing` against this business's own sell items — Step C2a's
  review screen skips those; run inline when AI_FAKE or by management/commands/run_ai_jobs.py
  otherwise),
  matching.py (fuzzy stock-item matching + unit_family for the recipe prompt — Step U1b-1: `bottle`
  dropped from the ml family, now falls through to the "pieces" default, a count-family pack unit),
  prompts.py
  (RECIPE_PROMPT_VERSION, recipe_tool()'s dish_name field now carries a description naming the key),
  views.py (Step C2c's AI_FAKE-only `FORCE_NEVER_FINISH` marker — a PDF carrying it leaves the scan
  QUEUED forever, for testing the stuck-scan UI; an image upload can't carry it, since the client
  always resizes/re-encodes photos before upload), admin.py (`MenuScanAdmin`/`AiUsageAdmin`,
  superuser-only, read-only), urls.py. `management/commands/run_ai_jobs.py` (the `worker` service's
  poll loop — Step C2c: a per-job try/except marks a crash `failed` instead of dying, a heartbeat log
  every 5 minutes, start/per-job id+outcome logging, 10-minute stuck-`reading` recovery).
  Step EK-1/EK-2: `knowledge/` (plain `<sector>.json` base-template + portion-default + rule +
  `type_rules` files, `dish_types.json`'s shared sector-agnostic taxonomy, `load_library()`/
  `load_dish_types()` — empty-but-same-shape fallback for a sector with no file). `base_discovery.py`:
  `expand_dish_options` — a dish's own `variants`/`variant_position`("prefix"/"suffix")/
  `variant_prices` (schemas.ExtractedDish, Step EK-2) builds the real combined name(s) and per-variant
  price, no model call, covers both an inline "Chicken (A/B/C)" line and a heading-plus-separate-
  choices group (e.g. a "MANCHURIAN" heading over "Gobi/Paneer/..."); `discover_bases` — EK-2
  replaced the old free-form model-mapping with classify-then-map: `classification.py`'s
  `classify_dishes` (model picks only a type + family per dish, batched ~60/call, cached per dish
  name in `AiDishTypeCache` keyed on sector + `prompts.CLASSIFY_PROMPT_VERSION`) then
  `map_bases_from_classification` looks the base + grams/ml per portion up deterministically from
  the sector's `type_rules` (a `family_overrides` entry, e.g. mutton 220g, wins over the type's own
  default) — the model never invents a base/formula/quantity; `sanity_check` drops a base under the
  sector's min-dishes rule and flags (never silently fixes) a formula summing to MORE than its own
  yield (under-filling is expected now that water is removed from every template, noted in each
  template's own `notes` instead) or an implausible per-portion amount. Final per-menu mapping result
  cached by `AiKitchenBaseCache` keyed on sector + normalised dish-name-set hash +
  `base_discovery.MAPPING_VERSION`. `AI_MODEL_KITCHEN` env (default claude-haiku-5-5,
  `AI_MODEL_FALLBACK` same as the other two calls); `AiUsageKind.KITCHEN_BASE_DISCOVERY`. No endpoint
  or screen yet — `scripts/ai_try_kitchen.py` is the only caller today, proved against real menus.
  Step EK-2b: a designed, multi-column menu still left a bare heading dish (e.g. just "Manchurian")
  from the combined pass alone — new `extract_menu_groups`/`GROUP_SYSTEM_PROMPT`/`group_tool()`
  (`prompts.py`) is a second, dedicated pass over the same file(s) that finds only groups;
  `schemas.ExtractedGroup`/`merge_group_results`; `extraction.run_menu_extraction` runs it per
  page-chunk after the main pass (`MenuExtractionOutcome.groups`, skipped when the chunk isn't a
  menu). Step EK-2c: the group pass now returns each group's own FINAL dish names directly
  (`dishes: [{name, price}]`, prefix/suffix labels dropped — unreliable word order); `base_discovery.
  apply_groups` is the single source of truth for a heading both passes found (drops the first
  pass's own matching expansion), drops a bare choice-word fragment from the same table
  (`_is_choice_fragment`, e.g. a leftover "Veg" beside a group's own "Fried Rice Veg"), and ends with
  `dedup_dishes` (merges a dish duplicated in a different word order/casing, e.g. "Gobi Manchurian"
  vs "Manchurian GOBI"). `expand_dish_options` drops a variant that duplicates its own heading (stops
  "Gulab Jamun Gulab Jamun"). New sector-knowledge types (`plain_fried_snack`/`dry_masala_fry`/
  `gravy_thai`/`butter_garlic`/`bread_maida`, all no-base) plus `restaurant_cafe.json`'s
  `rules.keyword_type_overrides` (`classification.classify_dishes` applies these deterministically
  after the model, on every call AND every cache hit, so malai/naan-kulcha/Thai-curry/butter-garlic/
  fries/mutton-fry dishes can't be misclassified by the model) — `CLASSIFY_PROMPT_VERSION` 1->3 (also
  clarified the fried_starter_tossed/dry wet-vs-dry split after a real run funnelled nearly
  everything into tossed), `base_discovery.MAPPING_VERSION` 1->2. Step EK-2d: a dish can now map to
  up to 2 bases — `DishClassification.secondary_type` (optional, model-reported) and
  `base_discovery._secondary_types_for` (deterministic: `restaurant_cafe.json`'s
  `two_base_starter_rule` adds whichever of fried_starter_dry/fried_starter_tossed ISN'T the primary
  type to a dish naming both a protein/veg and a frying style, e.g. Chicken Chilli, Gobi Manchurian,
  Prawn Pepper — real kitchens batter AND sauce these, the model can only pick one primary) both feed
  `map_bases_from_classification`'s new `add_mapping` helper (dedups so a dish is never double-listed
  in the same base); `CLASSIFY_PROMPT_VERSION` 3->4. Step EK-3: `recipe_composer.py` — `suggest_setup`
  (best-seller picker, per-family recipe composer capped at 25 AI calls/menu via `_merge_small_
  families`, ingredient resolver merging near-duplicates and matching/proposing stock items), new
  `AiFamilyRecipeCache`, `FAMILY_RECIPE_PROMPT_VERSION`/`BEST_SELLER_PROMPT_VERSION` (`prompts.py`).
  No endpoint/screen yet — `scripts/ai_try_kitchen.py --setup` is the only caller today. Step EK-3c:
  `resolve_ingredients` now also runs one `AI_MODEL_KITCHEN` call (`provider.merge_ingredients`,
  `MERGE_PROMPT_VERSION`) grouping remaining near-duplicate names into one purchasable item and
  tagging every item's low-stock category; a group is applied only when `_group_is_safe` passes
  (same unit family, no conflict on the sector's new `never_merge` knowledge-JSON list); excludes
  Water/Ice/Ice cubes entirely (never a stock item); `_guess_low_stock_category` now checks
  `dry_staples` before `perishable`/`fresh_semi` (a processed form must win over the fresh thing
  it's made from). Step EK-3d: `base_discovery.apply_groups`/`expand_dish_options` gained
  `_is_blob_leftover` (drops a first-pass dish still covering a group-pass table, whole-blob or
  compound-heading-residue shaped), `_dedup_key`-based group-dish matching (the group pass's own name
  always wins a word-order tie), `_variant_already_in_heading` (stops a variant already inside the
  heading gluing on twice), a 2-word repeated-phrase collapse (`_REPEATED_PHRASE`), `_resolve_slash_
  name` (a lone "A / B" with a shared word collapses to the fuller half + a "check this" note; no
  shared word stays combined, unflagged), and `_drop_bare_duplicates` (a bare heading dropped beside
  its own Veg/Chicken/... sibling). `recipe_composer.build_families` now rejects a dish that's an
  outlier against its own group's majority word signature (`_family_outliers`) into a fallback bucket
  ("Fried starters" for starter types), and merges any two families left sharing one display name.
  "Mixed"-named dishes never get a single protein as a main item (silently, not flagged). 6 new
  `restaurant_cafe.json` aliases (turmeric/hung curd/tomato sauce/rice/chilled milk/vanilla ice
  cream) plus `never_merge` protection for Kashmiri red chilli vs red chilli powder and soy sauce
  variants; a base already carrying Dark/Light soy sauce also excludes a generic "Soy sauce" from its
  family's own ingredient list.
  Step EK-4a: `EkSetupRun` (business, menu_scan OneToOne — one run per scan, status queued/running/
  done/failed, heartbeat, error, result, cost fields mirroring AiUsage); `ek_setup.py`
  (`build_dish_input` — the business's own current active sell items, so deletions/edits are
  respected with no FK back to the scan; `build_owner_result` — suggest_setup's raw shape mapped to
  dish ids and display-formatted via stock/units.py, cost/model/vendor wording stripped);
  `jobs.process_ek_setup_run` (inline under AI_FAKE, else `run_ai_jobs` — same per-job try/except,
  heartbeat, 10-minute stuck-`running` recovery as MenuScan); `views.EkSetupView` (POST starts or
  returns the existing run idempotently, GET polls), Owner-only (`sellitems.manage`), gated by the
  monthly cap and the same daily-scan bucket as menu scans (`AI_DAILY_SCANS_PER_BUSINESS`). No
  StockItem/SellItem/Recipe/Base writes — unchanged from suggest_setup's own contract.
  Step EK-4a2: `suggest_setup`'s `on_progress` keeps `heartbeat` fresh across a long run;
  `provider/base.py`'s `run_with_fallback` retries a provider-call failure once before the fallback
  model, with stage/label logging; `compose_family_recipes` skips (never fails the run for) one bad
  family past that, up to a 20% failure cap (`MAX_FAMILY_FAILURE_RATIO`); `pick_best_sellers`/
  `_merge_ingredient_entries` degrade to their existing deterministic paths on a failed call instead
  of raising; new `EkSetupRun.error_detail` (diagnostic only, never owner-facing);
  `build_owner_result` gained `incomplete`/`dishes_without_suggestion`. `fake.py`'s
  `FORCE_PROVIDER_ERROR` family-name marker (smoke's `check_recipe_composer_flow`) proves it.
- Step 21a: Django admin (platform staff only, not business roles) at env `ADMIN_URL_PATH` (default
  `manage-ek/`); `admin.py` in accounts/businesses/stock/alerts (editable) and counts/purchases/
  sales/wastage/audit (read-only); `config/admin_security.py` (login rate limit), `config/
  admin_mixins.py` (`ReadOnlyAdminMixin`/`ReadOnlyInlineMixin`; Step C2c's `SuperuserOnlyAdminMixin` —
  hides the model from staff who aren't a superuser, used by `ai.MenuScanAdmin`/`AiUsageAdmin`). Step
  F1: `accounts.UserAdmin` delete is superuser-only (never self, never the last active superuser);
  `businesses.BusinessAdmin.delete_business_and_data` (superuser-only action, confirm page at
  `businesses/templates/admin/businesses/confirm_delete_business.html`) deletes a business and all its
  data in PROTECT-safe order, one transaction, one audit-log line — `Business`/ledger models otherwise
  stay undeletable directly.

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
  sell item uses it; Step 41b1b3a's three threshold fields need `stockitems.thresholds_manage`,
  every other field still needs `stockitems.manage`
- `GET businesses/<id>/stock/low-stock/` — LowStockListView — Step 41b1b3a: items below threshold +
  shopping-list `suggested_order_qty`, grouped by stock group; `stock.low_stock_view` sees qty only,
  a caller who can also see money (thresholds_manage/alerts.view) gets `shortfall_value` too
- `GET businesses/<id>/sell-items/` — SellItemListView — Owner (`sellitems.manage`, `?include_inactive=1`
  for Settings) or Owner/Manager (`sales.view`/`sales.create`, active items only, for Record sales)
- `POST businesses/<id>/sell-items/bulk/` — SellItemBulkCreateView
- `POST businesses/<id>/sell-items/` — SellItemListView.post — single dish create, `ingredients`
  and/or `bases` (Step 42b1c1), needs at least one real line between the two
- `PATCH businesses/<id>/sell-items/<item_id>/` — SellItemDetailView — `uses_qty` needs a main
  stock item; `ingredients`/`bases`, each full-replace when present
- `GET/POST businesses/<id>/bases/`, `GET/PATCH/DELETE .../bases/<id>/` — BaseListView/
  BaseDetailView — Step 42b1c1: batch recipes ("bases"), Owner-only (`sellitems.manage`); DELETE on
  an in-use base is refused (409, dish names) unless `confirm_unlink: true`
- `PUT businesses/<id>/bases/<id>/used-in/` — BaseUsedInView — full-replace which dishes use this
  base and at how many grams/ml per portion (no screen yet — see docs/STATUS.md)
- `GET businesses/<id>/suppliers/` — SupplierListView — distinct supplier names typed so far
- `GET/POST businesses/<id>/purchases/` — PurchaseListCreateView — list + today/7-day summary, record
- `GET/PATCH/DELETE businesses/<id>/purchases/<pid>/` — PurchaseDetailView — soft-delete on DELETE
- `GET businesses/<id>/counts/form/?type=` — CountFormView — blind form: id/name/unit plus
  unit_family/pack_size_base_qty (Step U1b-3b-1, for QuantityInput) — still no last count/expected/
  prices
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
- `POST businesses/<id>/ai/menu-scans/` — MenuScanCreateView — 1-6 images or one PDF, 202 `{id, status}`;
  `GET .../menu-scans/<scan_id>/` — status + sections/dishes once done, `incomplete`+message if a
  chunk hit max_tokens or the 400-dish cap
- `POST businesses/<id>/ai/recipe-suggestions/` — RecipeSuggestionView — `dish_ids` or `dishes:[{name}]`,
  max 15/call; both `sellitems.manage`, 429/503 on limits, see ai/limits.py
- `POST/GET businesses/<id>/ai/menu-scans/<scan_id>/ek-setup/` — EkSetupView — Step EK-4a: starts
  (or idempotently returns) the EK setup run for this scan / polls it; `sellitems.manage`, same
  429/503 caps as above, owner-facing result shape in docs/STATUS.md

## Mobile routes (mobile/app/, file-based via expo-router)

- `_layout.tsx` — root layout: font loading, AuthProvider, offline banner
- `index.tsx` — redirects signed-out → landing, signed-in → /home or /setup/<n>
- `signup.tsx` — create account; Step F2 added the `business_name` field (asked once, here)
- `login.tsx` — mobile + password/PIN
- `+not-found.tsx` — 404
- `setup/1.tsx`..`6.tsx` — onboarding wizard: business info, colour, stock, sell items, team, settings;
  Step F2: `setup/1.tsx` shows the signup-created business's name as a line with a Change link
  (inline edit) instead of an input — `BusinessForm`'s name field only renders for the fallback case
  (no business, or one with no name yet); a `useLayoutEffect` re-hydrates the draft from `existing`
  once it arrives, fixing a pre-existing mount-time race right after a fresh signup→login redirect;
  Step 22a2: `setup/4.tsx`'s "Add your own" dish opens the same `SellItemSheet`/`DishRecipeForm` as
  Settings, not a separate ingredients-free form; Step O1: `setup/4.tsx`'s old scan-vs-manual choice
  card is gone (moved to `setup/fork.tsx`) — it now always opens straight on the list+form
- `setup/fork.tsx` — Step O1: "How do you want to set up?", shown once right after step 1 for
  menuScanEnabled sectors only (`Business.onboarding_path` — `""`/`quick`/`diy` — persists the
  choice so a reload or "Save and continue later" resumes at the fork, not step 2); "Quick setup
  from my menu" launches `/menu-scan` directly (before brand/buy are visited); "I'll set it up
  myself" continues to `setup/2` same as a sector with no fork. `setup/1.tsx`'s Next and
  `business/routing.ts`'s `nextRouteAfterAuth` both route here instead of `/setup/2` when
  applicable; `setup/2.tsx`'s Back returns here too, so the path can be switched any time (nothing
  already added is ever deleted). Existing businesses already past step 2 with no path saved
  default to DIY silently (resume logic only intercepts exactly at step 2)
- `menu-scan/index.tsx` (source), `menu-scan/analyzing.tsx`, `menu-scan/review.tsx`, `menu-scan/
  done.tsx` — Step C2a: the menu-scan flow, reached from onboarding's fork and Settings'
  "What you sell" (`?businessId=&returnTo=onboarding|settings`); Step O1: the onboarding "Back"/
  cancel paths now point at `/setup/fork` (not `/setup/4`, which no longer offers scan/manual), the
  AI-unavailable "Add one by one" escape hatch continues at `/setup/2` (brand), and `done.tsx`'s
  Continue goes to `/setup/2` next (brand hasn't been visited yet in the quick path) with no
  onboarding PATCH of its own — `setup/3.tsx` shows how many scanned dishes still need ingredients
  (`recipe_status !== 'confirmed'`) and `setup/4.tsx`'s own Next still marks step 4 done as normal;
  source picks 1-6 photos (camera/
  gallery, client-resized to ~1600px/JPEG~0.8 via `forms/menuFileValidation.ts`'s
  `resizeImageForUpload`, web-only `forms/filePicker.ts`) or one PDF, POSTs `ai/menu-scans/`; the scan
  id is kept in `screens/menuScanDraft.ts` (web localStorage/native SecureStore) so leaving and
  returning resumes polling instead of restarting; analyzing polls every 3s (6s after 30s); Step C2c:
  still queued/reading past `STUCK_AFTER_MS` (3 minutes, `EXPO_PUBLIC_MENU_SCAN_STUCK_AFTER_MS`-
  overridable) shows "This is taking longer than usual" with Try again/Add one by one, same as a real
  `failed` scan, but polling keeps running underneath in case it finishes right after; review is
  an editable grouped dish list (tick/edit name+price/delete, section rename via a `Sheet`, "Add a
  dish", "Add another photo" merges a second scan de-duplicated by name, skips dishes already on the
  sell-items list); save POSTs `sell-items/bulk/` (section name -> `group`, `skip_existing: true`);
  done shows the count and continues onboarding or returns to Settings
- `setup/done.tsx` — wizard summary, "still to do" list
- `home.tsx` — Home: OwnerHome (Owner/Manager) or TodayHome (Head chef/Helper), role-branched; Step
  23d's Owner-only "Count your starting stock" nudge, from `today/`'s `is_first_count`; Step
  45b1c2b's "Recipes cover X% of your sales" banner (`reports.view`, reuses `reports/summary/
  ?period=30d`'s `recipe_coverage_pct` — no new endpoint), tapping it opens `/settings/sell?
  filter=needs_ingredients`
- `buy/index.tsx` — Purchases list + today/7-day summary
- `buy/[id].tsx` — Purchase detail, edit, delete
- `stock/index.tsx` — Stock list; Step 43b1c2a added a "Low stock & shopping list" link
  (`stock.low_stock_view`)
- `stock/[id].tsx` — Stock item detail + price chart + recent purchases; Step 43b1c2a's "Low-stock
  alert" button (Manager, `stockitems.thresholds_manage` without `stockitems.manage`) opens
  `StockItemSheet` in its new `mode="thresholds"`
- `stock/low-stock.tsx` — Step 43b1c2a: the low-stock/shopping-list screen (`GET
  stock/low-stock/`), grouped by stock group, reachable from Stock (Owner/Manager) and a Home
  nudge card (+ Head chef via Home only, who has `stock.low_stock_view` without `stock.view`)
- `wastage.tsx` — Wastage list, record, delete
- `count.tsx` — Blind stock count form (opening or closing); Step 23d: a business's first-ever count
  is framed "Starting stock" with an intro card, Save enables at 1+ item counted (untouched items
  submit as skipped)
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
  "Needs ingredients"/"Estimate - confirm"), "Add {label}" opening `SellItemSheet` (DishRecipeForm,
  add or edit) — Step 22a2 removed its old ingredients-free quick-add box; Step C2a added an "Add
  from menu" button (sectorCopy's `menuScanEnabled` + `sellitems.manage`) to `/menu-scan`;
  `?filter=needs_ingredients`
  and `?edit=<id>` query params drive it from Home's nudge and a count-gap reason link; Step
  42b1c1's `DishRecipeForm` "use a batch recipe" section is wired in here (fetches `bases/`); `setup/
  4.tsx`'s own dish form doesn't pass `bases` yet, so that picker stays hidden there; `settings/
  bases/index.tsx` — Step 42b1c1: "Things you make in batches" list + add/edit sheet (`BaseSheet`/
  `BaseRecipeForm`), Owner-only; Step 45b1c2b: `BaseSheet` gained Delete (in-use or not, same
  confirm-unlink DELETE endpoint) and a link to `settings/bases/[id].tsx` — the base's own "Used
  in" screen (search/add a dish, edit grams, remove a dish, full-replace `PUT .../used-in/`);
  `settings/alerts.tsx` — the 6 alert settings (Step 18 added
  expiry_warn_days; the hub's "Expiry alerts" row links here too, not its own screen)
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
- `Checkbox.tsx` — labelled checkbox, 44px target; Step C2a's `accessibilityLabel` prop overrides the
  `title`/`helpText`-derived one, for a row where the visible name lives in an adjacent field
- `ConfirmDialog.tsx` — centered confirm/cancel dialog (destructive actions)
- `constants.ts` — breakpoints (BREAKPOINT_TABLET=600, NAV_SIDE_BREAKPOINT=840), touch/control sizes
- `EmptyState.tsx` — "nothing here yet" block with optional action
- `GroupedList.tsx` — Step 19: collapsible group headings (Ungrouped last) over a flat item list —
  Settings' stock/sell lists, the wizard's "added items" list, DishRecipeForm's ingredient picker;
  Step 20 added optional `countLabel`/`headerAccessory` props for the starter-stock picker's "N of
  M" + Select all
- `Icon.tsx` — named lucide-react-native icon registry (IconName union); Step C2a added
  `camera`/`image`/`document`/`scan`
- `MobileField.tsx` — TextField with a fixed "+91" prefix
- `NoAccess.tsx` — "you don't have access" block
- `OfflineRetry.tsx` — offline banner + retry
- `PasswordField.tsx` — Step F3: TextField + Show/Hide toggle; `mode` ('password', with a strength
  meter, or 'pin', numeric keypad/no meter) and `resetSignal` (re-hides on submit or sheet
  open/close) — the one shared field for every password/PIN field in the app (login, signup, team
  add/change-role/reset-secret), replacing three separate inline PIN-toggle copies
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
- `TextField.tsx` — labelled input, 5 states (empty/focused/filled/error/success); Step C2a's
  `accessibilityLabel` prop overrides the `label`-derived one, for a repeated field across rows
- `Toast.tsx` — transient bottom toast
- `Toggle.tsx` — on/off switch

## Shared state / cross-cutting (mobile/src/)

- `auth/AuthContext.tsx` — signed-in user, businesses list, tokens, authedFetch, login/logout/refresh,
  setActiveBusiness (moves a business to the front of the list — "Switch business")
- `auth/permissions.ts` — `can(permissions, 'x.y')`, `isLimitedRole(permissions)`
- `auth/storage.ts` — access/refresh token persistence (SecureStore on native, localStorage on web)
- `api/client.ts` — fetch wrapper: base URL, timeout, typed ApiError
- `api/{auth,business,stock,purchases,counts,wastage,team,sales,alerts,reports,geo,menuScan}.ts` — one
  typed client per backend resource (`geo.ts` is Step 21b's `PincodeLookup` type only, no fetch helper
  — the fetch itself is in `PincodeLocationField.tsx`, like every other screen-level `authedFetch`
  call; `menuScan.ts` is Step C2a's types only too — `ExtractedDish`/`ExtractedSection`/
  `MenuScanDetail`, fetches live in `app/menu-scan/*.tsx`)
- `business/routing.ts` — where to send a signed-in user (wizard step vs /home)
- `screens/countDraftStorage.ts` — in-progress blind count draft, survives a reload;
  `screens/menuScanDraft.ts` — Step C2a: the in-progress menu scan's id per business (same
  web-localStorage/native-SecureStore split), so leaving and returning to the Analyzing screen
  resumes polling instead of starting a new scan
- `forms/groupItems.ts`, `forms/validateStockItem.ts`, `forms/validateSellItem.ts`,
  `forms/validateNumber.ts`, `forms/itemDraftStorage.ts` — Step 19: grouping, shared client-side
  validation and duplicate-name checks, and half-typed-add-form persistence, one of each, reused by
  every stock/sell-item add form instead of four separate copies
- `forms/filePicker.ts` — Step C2a: a hidden `<input type="file">` (web only), `capture="environment"`
  for the menu-scan source screen's camera button; `forms/menuFileValidation.ts` — its photo/PDF
  size/type limits plus `resizeImageForUpload` (canvas, ~1600px long side, JPEG ~0.8 quality, steps
  quality down further if still over 4 MB)
- `hooks/useInstantAdd.ts` — Step 19: one Add tap saves immediately (optimistic, rolled back on
  failure) and clears/refocuses the form — used by setup/3, setup/4 and both Settings item lists
- `screens/ComingSoonScreen.tsx` — shared stub for Team/Settings
- `screens/ProfileSheet.tsx` — name/role/business, Switch business (if >1), Account (coming soon),
  Log out — the only place Log out lives now, opened from AppShell's avatar/user block
- `screens/RecordPurchaseSheet.tsx`, `RecordWastageSheet.tsx`, `RecordSalesSheet.tsx` — the shared
  record sheets; `RecordPurchaseSheet` (U1b-3a) and `RecordWastageSheet` (U1b-3b-1) both use
  `forms/QuantityInput.tsx` (amount + unit chips, entryUnitsFor-driven) and send `entry_unit` per
  line. `RecordSalesSheet` doesn't (sales quantities are whole units sold, not entry-convertible)
- `screens/ChangeBusinessTypeSheet.tsx` — Step 23: the keep-or-remove-items sheet shown on a
  `business_type` change, from setup/1 (going back) and Settings' Business profile
- `screens/TeamAddSheet.tsx`, `ChangeRoleSheet.tsx`, `ResetSecretSheet.tsx` — Team screen sheets: add
  a member, change role (asks for a new secret only when crossing the Manager boundary), reset a
  PIN/password
- `screens/StockItemSheet.tsx` — Settings' stock add/edit sheet; `SellItemSheet.tsx` — Step 22a dish
  add/edit sheet wrapping `DishRecipeForm` (null `editingItem` = create); Step 22a2: takes an
  explicit `business` prop (not `businesses[0]`) and is reused by both Settings' `settings/sell.tsx`
  and onboarding's `setup/4.tsx`
- `screens/StarterStockPicker.tsx` — Step 20: the grouped/searchable starter-stock picker (setup/3
  and Settings); `StarterStockPickerSheet.tsx` wraps it in a Sheet with its own Continue button for
  the Settings entry point
- `forms/StockItemForm.tsx`, `BusinessForm.tsx` (Step F2's `showName` prop — false on setup/1 once a
  business already has a name, always true on Settings' Business details), `BrandForm.tsx` — one
  shared form component each, used by both the setup wizard and Settings. Step U1b-3b-1:
  `StockItemForm` groups its unit chips into Weight/Volume/Count (`units.ts`'s `unitFamily`), adds a
  pack-size field (`packSizeBaseQty`, shown for weight/volume units and `bottle`), and shows a
  `unitLocked` banner (from `StockItem.unit_locked`) once the item has history. Step 22a's `DishRecipeForm.tsx`
  (+ `validateDish.ts`) is the full dish form with ingredients, used only via `SellItemSheet` — Step
  22a2 deleted the old ingredients-free `SellItemForm.tsx`/`validateSellItem.ts`, now unused
  everywhere. Step U1b-3b-1: ingredient rows use the shared `forms/QuantityInput.tsx` + `entry_unit`
  (same as counts/wastage/purchases), not the old ingredient-only conversion. Step 43b1c2a:
  `StockItemForm` gained the low-stock threshold section (`canManageThresholds`/`thresholdsOnly`
  props — category chips from `constants/lowStockCategories.ts`, optional override days, optional
  fixed qty via `QuantityInput`, a plain-words effective-threshold line); `StockItemSheet` gained
  `mode: 'thresholds'` for a Manager's narrower PATCH (thresholds only, not the rest of the item)
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
  `sellPortionPlaceholder`; Step C2a added `menuScanEnabled`/`menuNoun` ("menu" or "price list") —
  true for the 4 food types + homestay, false elsewhere); `labels.ts` is now a thin wrapper over it
- `labels.ts` — copy that varies by business type (delegates to sectorCopy.ts)
- `units.ts` — Step U1b-3a: the shared unit-family/entry-unit/rounding module, mirrors
  `backend/stock/units.py` exactly (`scripts/check_units_parity.mjs` fails the build if they drift).
  Step U1b-3b-1 migrated `DishRecipeForm` onto it too and deleted the old ingredient-only
  `forms/unitConversion.ts` — every quantity-entry screen now shares this one module
- `forms/QuantityInput.tsx` — Step U1b-3a: the shared quantity-entry control (number field + unit
  chips from `units.ts`'s `entryUnitsFor`) used by purchases, counts (`app/count.tsx`), wastage
  (`RecordWastageSheet.tsx`) and dish ingredients (`DishRecipeForm.tsx`, Step U1b-3b-1)
- `format.ts` — ₹ and date/time formatting in the business's own timezone
- `theme/tokens.ts` — colours, spacing, radii, type sizes (closed set)
- `theme/brand.ts` — per-business brand colour + WCAG contrast
- `hooks/useMinWidth.ts`, `hooks/useOnlineStatus.ts` — responsive breakpoint, online/offline state

## Scripts and npm commands (root package.json)

- `npm run dev` → `scripts/dev.mjs` — starts backend + Expo web together
- `npm run check` → `check:backend` (ruff via `scripts/check_backend.ps1`) + `check:mobile` (eslint/prettier/tsc)
- `npm run smoke` → `scripts/smoke.py` — backend-only API walk, one user story per feature; Step 23e's
  `--area <name>` (counts/stock/sales/alerts/wastage/permissions/onboarding/reports/ai, repeatable) runs
  only that area's checks — each `check_*_flow` is fully self-contained, so this is a safe subset
- `npm run flow` → `scripts/flow.mjs` — full browser walk: signup→wizard→all 4 roles→core actions;
  Step 23e's `--only <scenario>` (`--list` to see names) runs one scenario — a "solo" one stands alone,
  a "chain" one reruns every earlier chain scenario first (shared Owner session) then stops; Step
  C2a's `menu-scan` (solo) drives the whole scan/upload/analyze/review/save/done flow via a real
  file-chooser (Puppeteer's `waitForFileChooser`) against `docs/images/ek_logo_icon.png`, then Step
  C2c appends a second scan (via `docs/images/menu_scan_force_never_finish.pdf`, whose AI_FAKE-only
  marker leaves it queued forever) proving the stuck-scan "taking longer than usual" UI; the `wizard`
  chain scenario now clicks "Add one by one" on step 4's new choice card first; Step 44v1 added
  `bases` (solo) and `low-stock` (solo, + Manager/Head chef/Helper permissions) — a shared dev IP
  running these (and other signup-heavy scenarios) repeatedly may need `RATE_LIMIT_SIGNUP_PER_IP`
  set high when starting the backend (default stays 32/hour)
- `npm run responsive` → `scripts/responsive_check.mjs` — every route + sheet/dialog at 7 widths; Step
  23e's `--screen <name>` (`--list` to see names) builds only the session tier that screen needs
  (Step C2a also fixed `buildOwnerSession`'s stale pre-22a2 "Add your own" steps — it still assumed
  the old always-visible inline Selling price fields instead of opening the DishRecipeForm sheet,
  found while adding the new step-4 choice-card click)
- `npm run responsive:selftest` — proves the clipping check can actually fail
- `npm run verify -- --area X` / `verify:ui -- --area X --flow Y --screen Z` / `verify:full` →
  `scripts/verify.mjs` — Step 23e's tiers: check+smoke-area, +one flow scenario+one responsive screen,
  or the full check+smoke+flow+responsive (user-run before deploys, not during a step)
- `npm run icons` → `scripts/generate_icons.mjs` — favicon/PWA icon set from `docs/images/ek_logo_icon.png`
- `npm run pwa-check` → `scripts/pwa_check.mjs` — manifest/service-worker sanity check
- `npm run check:sector-copy` → `scripts/check_sector_copy.py` — Step 22: fails if food wording
  (dish, chef, kitchen, ingredient, ...) appears in a non-food business type's sectorCopy.json or
  starter_packs.json, or a catalogue item's unit isn't in its type's `allowedUnits`
- `npm run check:entrypoint` → `scripts/check_entrypoint.sh` — Step C2c: proves backend/entrypoint.sh
  `exec`s a given command and still defaults to gunicorn with none, without Docker or a real database
- `npm run build:web` / `serve:web` → `scripts/patch_web_shell.mjs` / `serve_web.mjs` — static web export
- `scripts/lib/landing_server.mjs` — throwaway static server for landing/index.html, used by flow/responsive

## Settings and permissions (backend/businesses/permissions.py, backend/config/settings.py)

| Role | Permissions |
|---|---|
| Owner | all 27 — `ALL_PERMISSIONS` computed, not hand-listed (Step 23a); see `docs/STATUS.md`'s permission table |
| Manager | purchases.view/create, stock.view, stockitems.thresholds_manage, counts.review, wastage.view_all/view_value, team.view, sales.view/create, alerts.view/check, reports.view |
| Head chef | counts.create, counts.status, wastage.create/view_all, stock.low_stock_view |
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
