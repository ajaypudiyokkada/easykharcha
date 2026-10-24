export type WastageReason = 'spillage' | 'spoiled' | 'over_prepared' | 'damaged' | 'other';

export type WastageEntry = {
  id: number;
  stock_item: number;
  stock_item_name: string;
  unit: string;
  quantity: string;
  /** `quantity` rolled up for display (e.g. 500 g -> "0.5"/"kg") — see src/units.ts. */
  display_quantity: string;
  display_unit: string;
  reason: WastageReason;
  note: string;
  recorded_by: number;
  recorded_by_name: string;
  recorded_at: string;
  /** Omitted entirely (not just null) by the server for a role without wastage.view_value. */
  value?: string | null;
};

export type WastageSummary = {
  today_value: string;
  last_7_days_value: string;
  today_entries: number;
};

export type WastageListResponse = {
  results: WastageEntry[];
  /** Only present for a role with wastage.view_value (Owner/Manager). */
  summary?: WastageSummary;
};
