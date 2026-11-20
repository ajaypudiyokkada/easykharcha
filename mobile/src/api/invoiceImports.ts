export type MatchState = 'matched' | 'check_match' | 'not_an_item_suggested' | 'unmatched';

export type ItemRef = { sell_item_id: number; name: string; score?: number };

export type ImportMatch = {
  state: MatchState;
  source: string;
  sell_item_id: number | null;
  sell_item_name: string | null;
  suggestion: ItemRef | null;
  alternatives: ItemRef[];
  score: number | null;
};

export type ImportLine = {
  line_id: string;
  name_as_printed: string;
  qty: string | null;
  unit_rate: string | null;
  amount: string | null;
  confidence: number | null;
  flags: { amount_mismatch: boolean };
  match: ImportMatch;
};

export type ImportCheck = {
  code: string;
  severity: 'block' | 'warn' | 'info';
  data: Record<string, unknown>;
  line_id?: string;
  needs_add_anyway?: boolean;
};

export type Charge = { label: string; amount: string | null };

export type ImportDraft = {
  bill_number: string | null;
  bill_date: string | null;
  bill_date_printed: string | null;
  bill_time: string | null;
  lines: ImportLine[];
  items_total: string | null;
  discounts: Charge[];
  taxes: Charge[];
  round_off: string | null;
  grand_total: string | null;
  payment_mode: string | null;
  is_reprint: boolean;
  confidence: Record<string, number>;
  checks: ImportCheck[];
  same_photo_before: boolean;
  same_photo_import_id: number | null;
  same_photo_invoice_id: number | null;
};

export type ImportStatus = 'queued' | 'reading' | 'ready' | 'failed' | 'abandoned' | 'confirmed';

export type InvoiceImport = {
  id: number;
  status: ImportStatus;
  error_code: string;
  error_reason: string;
  file_type: 'image' | 'pdf';
  created_at: string;
  started_at: string | null;
  heartbeat: string | null;
  finished_at: string | null;
  photo_available: boolean;
  photo_removed: boolean;
  draft?: ImportDraft;
  invoice_id?: number;
  invoice_number?: string;
};

export type LineDecision = {
  decision: 'item' | 'not_item' | 'skip' | null;
  sellItemId: number | null;
  remember: boolean;
};
