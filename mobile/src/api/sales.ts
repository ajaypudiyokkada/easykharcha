export type SaleSource = 'manual';

export type Sale = {
  id: number;
  sell_item: number;
  sell_item_name: string;
  business_date: string;
  quantity: string;
  amount: string;
  source: SaleSource;
  recorded_by: number;
  recorded_by_name: string;
  created_at: string;
};

export type SalesSummary = {
  sales_today: string;
  items_sold_today: string;
  last_update_at: string | null;
  last_7_days: string;
};

export type SaleListResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: Sale[];
  summary: SalesSummary;
};

/** One line being drafted in the Record sales sheet, before it's sent to the server. */
export type SaleLineDraft = {
  sellItemId: number | null;
  quantity: string;
  amount: string;
};
