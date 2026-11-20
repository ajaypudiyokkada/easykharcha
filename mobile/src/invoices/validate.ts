/** Client-side mirror of the server's invoice rules (backend/invoices/serializers.py + service.py),
 * so most mistakes show up before the review screen. The server stays the authority. */

import { parseScaled } from './money';
import type { InvoiceLineDraft } from './draft';

const MOBILE = /^[6-9][0-9]{9}$/;
const OLD_DATE_DAYS = 7;

/** '98765 43210', '+91 98765-43210', '919876543210', '09876543210' -> '+919876543210'; null if bad.
 * Empty input is fine (the phone is optional) and returns ''. */
export function normaliseIndianMobile(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  let digits = trimmed.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return MOBILE.test(digits) ? `+91${digits}` : null;
}

/** "+919845012345" -> "+91 98450 12345". */
export function formatPhone(normalised: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(normalised);
  return m ? `+91 ${m[1]} ${m[2]}` : normalised;
}

/** "Today" in the business's own timezone as YYYY-MM-DD. */
export function businessToday(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

export function isValidIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** True when `date` is more than 7 days before `today` (both YYYY-MM-DD). */
export function isOldDate(date: string, today: string): boolean {
  if (!isValidIsoDate(date) || !isValidIsoDate(today)) return false;
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
  return days > OLD_DATE_DAYS;
}

export type LineErrors = { quantity?: string; rate?: string };

export function quantityMilli(line: InvoiceLineDraft): number | null {
  const qty = parseScaled(line.quantity, 0);
  return qty !== null && qty >= 1 ? qty * 1000 : null;
}

export function ratePaise(line: InvoiceLineDraft): number | null {
  const rate = parseScaled(line.rate, 2);
  return rate !== null && rate > 0 ? rate : null;
}
