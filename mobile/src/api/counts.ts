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
  missing_opening: boolean;
};

export type CountListEntry = StockCount & {
  items_counted: number;
  items_skipped: number;
  items_not_sure: number;
  /** Step 14, Owner/Manager only. */
  flagged_gaps: number;
};

export type GapStatus = 'ok' | 'not_comparable';

export type GapReasonCode =
  'no_previous_count' | 'not_sold' | 'recipe_not_confirmed' | 'sales_missing';

/** Why a line's gap can't be computed — `count`/`sell_items` for recipe_not_confirmed (how many,
 * and which, dishes on this item still need their recipe confirmed), `dates` for sales_missing (the
 * exact business dates in the window with no sale recorded at all). */
export type GapReason = {
  code: GapReasonCode;
  count?: number;
  sell_items?: { id: number; name: string }[];
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

export type OpeningCountState = 'due' | 'late' | 'done';
export type ClosingCountState = 'locked' | 'due' | 'late' | 'done';
export type NextCountAction = 'opening' | 'closing' | 'none';

/** Step 23b: one opening count, then one closing count, per business date, clearly guided. Shared
 * shape returned by both `counts/today/` (the Count screen's own, focused call) and `today/`
 * (Home's richer call, which adds wastage/team/alerts fields around the same opening/closing). */
export type TodayStatus = {
  business_date: string;
  opening: {
    state: OpeningCountState;
    due_by: string;
    done_at: string | null;
    by: string | null;
  };
  closing: {
    state: ClosingCountState;
    due_from: string;
    done_at: string | null;
    by: string | null;
    /** True once a closing done now would be recorded without an opening for the day (the
     * opening was missed, not just skipped early) — lets the Count screen show the note before
     * saving, not just after. */
    missing_opening: boolean;
  };
  next_action: NextCountAction;
  wastage_entries_today: number;
  /** Only present for a role with counts.status (Head chef) — how many of the business's active
   * items have been counted by anyone today, out of how many there are. */
  team_progress?: { counted: number; total: number };
  /** Step 15, Owner/Manager only — the same count GET alerts/ would show. */
  alerts_count?: number;
};

/** `counts/today/`'s own response — same opening/closing/next_action, none of Home's extra
 * fields. */
export type CountsTodayStatus = Pick<
  TodayStatus,
  'business_date' | 'opening' | 'closing' | 'next_action'
>;
