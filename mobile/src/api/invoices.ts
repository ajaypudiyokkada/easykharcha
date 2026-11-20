export type InvoiceLine = {
  id: number;
  sell_item: number;
  name: string;
  quantity: string;
  rate: string;
  amount: string;
  sale: number;
};

export type Invoice = {
  id: number;
  number: string;
  source: 'created';
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
  lines: InvoiceLine[];
};

export type InvoiceSettings = {
  invoice_tax_enabled: boolean;
  invoice_tax_rate: string;
  bill_address: string;
  bill_phone: string;
  bill_gstin: string;
};
