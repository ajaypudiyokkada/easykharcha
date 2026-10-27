/** Step 42b1c1 (docs/BASES_PLAN.md secs 1-2, 5, 8.4): types for a "base" — a prep item batched
 * ahead of time (e.g. "onion-tomato masala") and used across dishes. Owner-facing screens call
 * these "things you make in batches"; "base" is the backend/docs term only. */

export type BaseIngredient = {
  id: number;
  stock_item: number;
  stock_item_name: string;
  /** Per the base's own `batch_yield_qty` (default 1,000 g/ml), in the stock item's base unit. */
  quantity_per_1000: string;
  display_quantity: string;
  display_unit: string;
};

export type BaseUsedInDish = {
  id: number;
  sell_item: number;
  sell_item_name: string;
  /** Per portion, in the base's own batch unit (g/ml). */
  quantity: string;
};

export type Base = {
  id: number;
  name: string;
  unit_family: 'weight' | 'volume';
  /** The base's own batch unit — always 'g' (weight) or 'ml' (volume). */
  unit: string;
  /** The batch size every ingredient's quantity is defined against — defaults to 1,000. */
  batch_yield_qty: string;
  ingredients: BaseIngredient[];
  used_in: BaseUsedInDish[];
  active: boolean;
  created_at: string;
};
