import type { PricePoint, StockItem } from './stock';

export type PurchaseLine = {
  id: number;
  stock_item: number;
  stock_item_name: string;
  unit: string;
  quantity: string;
  unit_price: string;
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
};

export type StockItemDetail = StockItem & {
  price_points: PricePoint[];
  recent_purchases: Purchase[];
};
