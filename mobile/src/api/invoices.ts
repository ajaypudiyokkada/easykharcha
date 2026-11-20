export type InvoiceLineKind = 'item' | 'not_item' | 'skipped';

export type InvoiceLine = {
  id: number;
  kind: InvoiceLineKind;
  name_as_printed: string;
  recorded_amount: string | null;
  sell_item: number | null;
  name: string;
  quantity: string | null;
  rate: string | null;
  amount: string | null;
  sale: number | null;
};

export type PaymentModeKey = 'cash' | 'upi' | 'card' | 'bank_transfer';

export type Invoice = {
  id: number;
  number: string;
  source: 'created' | 'imported';
  status: 'posted' | 'void';
  sale_date: string;
  date_is_old: boolean;
  customer_name: string;
  customer_phone: string;
  subtotal: string;
  tax_rate: string;
  tax_amount: string;
  total: string;
  created_at: string;
  voided_at: string | null;
  void_reason: string;
  payment_status: 'paid' | 'unpaid';
  payment_mode: PaymentModeKey | '';
  paid_at: string | null;
  proof_available: boolean;
  proof_removed: boolean;
  proof_already_used: boolean;
  bill_number_printed: string;
  bill_date_printed: string;
  bill_date: string | null;
  partly_recorded: boolean;
  lines_recorded: number;
  lines_total: number;
  printed_items_total: string | null;
  discount_total: string;
  tax_lines: { label: string; amount: string | null }[];
  round_off: string | null;
  bill_photo_available: boolean;
  bill_photo_removed: boolean;
  lines: InvoiceLine[];
};

export type InvoiceSettings = {
  invoice_tax_enabled: boolean;
  invoice_tax_rate: string;
  bill_address: string;
  bill_phone: string;
  bill_gstin: string;
};
