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
  /** Step 14, Owner/Manager only. */
  flagged_gaps: number;
};

export type GapStatus = 'ok' | 'not_comparable';

export type GapReasonCode = 'no_previous_count' | 'not_sold' | 'uses_not_set' | 'sales_missing';

/** Why a line's gap can't be computed — `count` for uses_not_set (how many sell items on this item
 * still need "how much does one use?" set), `dates` for sales_missing (the exact business dates in
 * the window with no sale recorded at all). */
export type GapReason = {
  code: GapReasonCode;
  count?: number;
  dates?: string[];
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
  /** Step 14, Owner/Manager only — the server omits none of these for Helper/Head chef, since they
   * can never reach this endpoint (no counts.review permission) in the first place. */
  expected_used: string | null;
  gap_qty: string | null;
  gap_value: string | null;
  gap_status: GapStatus;
  gap_reason: GapReason | null;
  flagged: boolean;
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
  /** Step 15, Owner/Manager only — the same count GET alerts/ would show. */
  alerts_count?: number;
};
