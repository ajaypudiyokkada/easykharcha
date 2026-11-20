/** The one place a customer bill becomes text. `buildBillLines` is the WhatsApp message;
 * `buildReceiptLines` is the same content laid out for a narrow (about 58mm) printed receipt.
 * Header lines (name, address, phone, GSTIN) appear only when set; Subtotal and Tax rows only when
 * the invoice itself charged tax (its own stored amount, never today's setting).
 * `scripts/check_bill_text.mjs` pins the exact output. */

import { formatPaise, parseScaled } from './money';

export type BillBusiness = {
  name: string;
  address: string;
  phone: string;
  gstin: string;
};

/** The parts of an Invoice (api/invoices.ts) a bill needs. */
export type BillInvoice = {
  number: string;
  sale_date: string;
  subtotal: string;
  tax_rate: string;
  tax_amount: string;
  total: string;
  payment_status: 'paid' | 'unpaid';
  payment_mode: string;
  lines: { name: string; quantity: string | null; rate: string | null; amount: string | null }[];
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-20" -> "20 Nov 2026" (a plain calendar date, no timezone involved). */
export function billDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

const paise = (value: string | null): number => parseScaled(value ?? '', 2) ?? 0;
const money = (value: string | null): string => formatPaise(paise(value));
const quantity = (value: string | null): string => String(Number(value ?? 0));

const MODE_WORDS: Record<string, string> = {
  cash: 'cash',
  upi: 'UPI',
  card: 'card',
  bank_transfer: 'bank transfer',
};

/** "Payment: Paid by UPI" or "Payment: Unpaid". */
function paymentLine(invoice: BillInvoice): string {
  if (invoice.payment_status !== 'paid') return 'Payment: Unpaid';
  const word = MODE_WORDS[invoice.payment_mode];
  return word ? `Payment: Paid by ${word}` : 'Payment: Paid';
}

function chargedTax(invoice: BillInvoice): boolean {
  return paise(invoice.tax_amount) > 0;
}

function taxLabel(invoice: BillInvoice): string {
  return `Tax ${Number(invoice.tax_rate)}%`;
}

function headerLines(business: BillBusiness): string[] {
  const lines = [business.name.trim()];
  if (business.address.trim()) lines.push(business.address.trim());
  if (business.phone.trim()) lines.push(business.phone.trim());
  if (business.gstin.trim()) lines.push(`GSTIN: ${business.gstin.trim()}`);
  return lines.filter(Boolean);
}

export function buildBillLines(business: BillBusiness, invoice: BillInvoice): string[] {
  const lines = [
    ...headerLines(business),
    `Invoice: ${invoice.number}`,
    `Date: ${billDate(invoice.sale_date)}`,
  ];
  for (const line of invoice.lines) {
    lines.push(line.name);
    lines.push(`${quantity(line.quantity)} × ${money(line.rate)} = ${money(line.amount)}`);
  }
  if (chargedTax(invoice)) {
    lines.push(`Subtotal: ${money(invoice.subtotal)}`);
    lines.push(`${taxLabel(invoice)}: ${money(invoice.tax_amount)}`);
  }
  lines.push(`Total: ${money(invoice.total)}`);
  lines.push(paymentLine(invoice));
  lines.push('Thank you.');
  return lines;
}

export function buildBillText(business: BillBusiness, invoice: BillInvoice): string {
  return buildBillLines(business, invoice).join('\n');
}

/** Greedy word wrap; a single word longer than `width` is cut. */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const piece = word.length > width ? word.slice(0, width) : word;
    if (!current) current = piece;
    else if (current.length + 1 + piece.length <= width) current += ` ${piece}`;
    else {
      out.push(current);
      current = piece;
    }
  }
  if (current) out.push(current);
  return out;
}

function center(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(pad) + text;
}

function leftRight(left: string, right: string, width: number): string {
  const gap = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(gap) + right;
}

/** The receipt as fixed-width lines (default 32 columns, about 58mm), for a monospace print. */
export function buildReceiptLines(
  business: BillBusiness,
  invoice: BillInvoice,
  width = 32,
): string[] {
  const rule = '-'.repeat(width);
  const lines: string[] = [];
  const header = headerLines(business);
  header.forEach((text, index) => {
    for (const row of wrap(text, width))
      lines.push(index === 0 ? center(row, width) : center(row, width));
  });
  lines.push(rule);
  lines.push(`Invoice: ${invoice.number}`);
  lines.push(`Date: ${billDate(invoice.sale_date)}`);
  lines.push(rule);
  for (const line of invoice.lines) {
    for (const row of wrap(line.name, width)) lines.push(row);
    lines.push(
      leftRight(`${quantity(line.quantity)} × ${money(line.rate)}`, money(line.amount), width),
    );
  }
  lines.push(rule);
  if (chargedTax(invoice)) {
    lines.push(leftRight('Subtotal', money(invoice.subtotal), width));
    lines.push(leftRight(taxLabel(invoice), money(invoice.tax_amount), width));
  }
  lines.push(leftRight('TOTAL', money(invoice.total), width));
  lines.push(rule);
  for (const row of wrap(paymentLine(invoice), width)) lines.push(row);
  lines.push(center('Thank you.', width));
  return lines;
}
