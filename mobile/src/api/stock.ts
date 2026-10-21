export type StockItem = {
  id: number;
  name: string;
  unit: string;
  usual_price: string | null;
  supplier: string;
  shared: boolean;
  goes_off: boolean;
  shelf_life_days: number | null;
  /** Free text, "" means Ungrouped — canonicalised case-insensitively against this business's
   * other stock-item groups by the backend (see backend/stock/views.py's _canonical_group). */
  group: string;
  active: boolean;
  created_at: string;
  /** From this item's purchase history — null until it's been bought at least once. */
  last_unit_price: string | null;
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
  /** The stock item's own unit — the quantity below is always already in it. */
  unit: string;
  /** Per ONE portion. */
  quantity: string;
};

export type SellItem = {
  id: number;
  name: string;
  selling_price: string;
  /** Short free text, e.g. "1 plate" or "6 pieces" — purely descriptive. */
  portion_label: string;
  /** `none` (no ingredients yet), `unconfirmed` (a future AI/scan estimate awaiting review — nothing
   * creates this yet) or `confirmed` (the manual dish form saved it with >=1 ingredient). Gap maths,
   * Count review, Alerts and Reports only trust `confirmed` dishes. */
  recipe_status: RecipeStatus;
  ingredients: SellItemIngredient[];
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
