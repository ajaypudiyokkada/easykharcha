export type StockItem = {
  id: number;
  name: string;
  unit: string;
  /** Step U1b-2: 'weight', 'volume' or 'count' — see src/units.ts. Drives which entry units
   * (kg/L/tonne, packet/bag/tin/bottle/box) this item accepts. */
  unit_family: string;
  /** "1 packet = N base units" — null until the owner sets it once. Never locked by history. */
  pack_size_base_qty: string | null;
  /** True once this item has any purchase/count/wastage/sale history — `unit`/`unit_family` can't
   * be changed to a different family any more (the server rejects it regardless). */
  unit_locked: boolean;
  usual_price: string | null;
  /** `usual_price` rolled up per kg/L (per piece/pack for a count item) — see src/units.ts. */
  usual_price_per_major_unit: string | null;
  supplier: string;
  shared: boolean;
  goes_off: boolean;
  shelf_life_days: number | null;
  /** Free text, "" means Ungrouped — canonicalised case-insensitively against this business's
   * other stock-item groups by the backend (see backend/stock/views.py's _canonical_group). */
  group: string;
  active: boolean;
  created_at: string;
  /** Step 43b1c2a: low-stock threshold inputs — see src/constants/lowStockCategories.ts. Editable
   * only with `stockitems.thresholds_manage`. */
  low_stock_category: string;
  low_stock_days_override: number | null;
  low_stock_fixed_qty: string | null;
  /** From this item's purchase history — null until it's been bought at least once. */
  last_unit_price: string | null;
  /** `last_unit_price` rolled up per kg/L (per piece/pack for a count item) — see src/units.ts. */
  last_unit_price_per_major_unit: string | null;
  last_purchased_at: string | null;
  /** From this item's count history — null until it's been counted at least once. No "on hand"
   * estimate here — that needs usage math a later step builds. */
  last_counted_qty: string | null;
  last_counted_at: string | null;
};

export type PricePoint = {
  date: string;
  unit_price: string;
};

export type RecipeStatus = 'none' | 'unconfirmed' | 'confirmed';

export type SellItemIngredient = {
  id: number;
  stock_item: number;
  stock_item_name: string;
  /** The stock item's own base unit — `quantity` below is always already in it. */
  unit: string;
  /** Per ONE portion, in the stock item's base unit. */
  quantity: string;
  /** `quantity` rolled up for display (e.g. 500 g -> "0.5"/"kg") — see src/units.ts. */
  display_quantity: string;
  display_unit: string;
};

/** Step 42b1c1: one base a dish uses, grams/ml per portion — see src/api/bases.ts's `Base`. */
export type SellItemBaseLink = {
  id: number;
  base: number;
  base_name: string;
  unit: string;
  quantity: string;
  display_quantity: string;
  display_unit: string;
};

export type SellItem = {
  id: number;
  name: string;
  selling_price: string;
  /** Short free text, e.g. "1 plate" or "6 pieces" — purely descriptive. */
  portion_label: string;
  /** `none` (no ingredients yet), `unconfirmed` (a future AI/scan estimate awaiting review — nothing
   * creates this yet) or `confirmed` (the manual dish form saved it with >=1 ingredient or base).
   * Gap maths, Count review, Alerts and Reports only trust `confirmed` dishes. */
  recipe_status: RecipeStatus;
  ingredients: SellItemIngredient[];
  /** Step 42b1c1: batch recipes ("bases") this dish uses, alongside its raw ingredients. */
  bases: SellItemBaseLink[];
  /** Its own namespace, not shared with stock-item groups. */
  group: string;
  active: boolean;
  created_at: string;
};

export type StarterPackStockItem = {
  name: string;
  unit: string;
  group: string;
  goes_off?: boolean;
  shelf_life_days?: number | null;
};

export type StarterPack = {
  stock_items: StarterPackStockItem[];
  sell_items: { name: string }[];
};

/** Step 43b1c2a: one row of `GET stock/low-stock/` — the low-stock/shopping-list read. Quantities
 * are already display-converted (kg/L once >=1,000 g/ml) server-side. `shortfall_value` is present
 * only for a caller who can also see money (`stockitems.thresholds_manage` or `alerts.view`) — a
 * Head chef's rows never carry it. */
export type LowStockRow = {
  stock_item: number;
  name: string;
  group: string;
  unit: string;
  estimated_stock_now: string;
  threshold: string;
  suggested_order_qty: string;
  is_estimate: boolean;
  coverage_pct: string | null;
  /** Some of `estimated_stock_now`'s usage subtraction rests on an unconfirmed (suggested, not
   * yet reviewed) recipe — flagged, not hidden, per docs/BASES_PLAN.md sec 8.3's estimate fix. */
  partly_unconfirmed: boolean;
  shortfall_value?: string | number | null;
};

export type LowStockListResponse = {
  results: LowStockRow[];
  grouped: Record<string, LowStockRow[]>;
};
