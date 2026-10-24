import type { PricePoint, StockItem } from './stock';

export type PurchaseLine = {
  id: number;
  stock_item: number;
  stock_item_name: string;
  unit: string;
  quantity: string;
  /** Step U1b-2: `quantity` rolled up for display (3,200 g -> "3.2"/"kg") — see src/units.ts. */
  display_quantity: string;
  display_unit: string;
  unit_price: string;
  unit_price_per_major_unit: string;
  line_total: string;
};

export type Purchase = {
  id: number;
  supplier: number | null;
  supplier_name: string | null;
  purchase_date_time: string;
  total_amount: string;
  note: string;
  recorded_by: number;
  recorded_by_name: string;
  created_at: string;
  updated_at: string;
  lines: PurchaseLine[];
};

export type PurchaseSummary = {
  bought_today: string;
  last_7_days: string;
  supplier_count: number;
};

export type PurchaseListResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: Purchase[];
  summary: PurchaseSummary;
};

/** One line being drafted in the Record purchase sheet, before it's sent to the server. */
export type PurchaseLineDraft = {
  stockItemId: number | null;
  quantity: string;
  unitPrice: string;
  /** What unit `quantity`/`unitPrice` were typed in (kg, packet, ...) — null means the item's own
   * base unit. The API converts both down to the stock item's base unit (see src/units.ts). */
  entryUnit: string | null;
};

export type StockItemDetail = StockItem & {
  price_points: PricePoint[];
  recent_purchases: Purchase[];
};
