export type CountType = 'opening' | 'closing';
export type CountLineState = 'counted' | 'skipped' | 'not_sure';

/** What counts/form/ returns — id, name and unit only, for every role. No last count, no expected,
 * no prices, no usual values: the server enforces the blind rule by simply never selecting them. */
export type CountFormItem = {
  id: number;
  name: string;
  unit: string;
};

export type StockCount = {
  id: number;
  count_type: CountType;
  business_date: string;
  counted_by: number;
  counted_by_name: string;
  submitted_at: string;
  deadline_at: string;
  is_late: boolean;
  minutes_late: number;
};

export type CountListEntry = StockCount & {
  items_counted: number;
  items_skipped: number;
  items_not_sure: number;
};

export type CountDetailLine = {
  id: number;
  stock_item: number;
  stock_item_name: string;
  unit: string;
  state: CountLineState;
  counted_qty: string | null;
  confirmed_unusual: boolean;
  previous_counted_qty: string | null;
  quantity_bought_since: string | null;
  quantity_wasted_since: string | null;
  used_since_last_count: string | null;
};

export type CountDetail = StockCount & { lines: CountDetailLine[] };

/** One line as composed on the device before it's sent — counted_qty stays a string (the typed
 * value) until the moment of submit. */
export type CountLineDraft = {
  stockItem: CountFormItem;
  state: CountLineState;
  countedQty: string;
};

export type TodayCountState = 'not_started' | 'done' | 'late';

export type TodayStatus = {
  opening: { state: TodayCountState; deadline_at: string };
  closing: { state: TodayCountState; deadline_at: string };
  wastage_entries_today: number;
  /** Only present for a role with counts.status (Head chef) — how many of the business's active
   * items have been counted by anyone today, out of how many there are. */
  team_progress?: { counted: number; total: number };
};
