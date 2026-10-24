/** Money and date formatting — Indian grouping (₹1,23,456) and the business's own timezone, not the
 * device's. Kept separate from strings.ts since these are formatters, not fixed copy. */

import { displayPricePerMajorUnit, displayQuantity } from './units';

const RUPEE_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** `"1280.00"` (a decimal string from the API) -> `"₹1,280"`. Rounds to the nearest rupee — paise
 * aren't shown anywhere in this app. */
export function formatRupees(amount: string | number): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return RUPEE_FORMATTER.format(0);
  return RUPEE_FORMATTER.format(value);
}

/** A plain number in Indian grouping, no currency symbol — for quantities, counts. */
export function formatIndianNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

/** An ISO datetime string, shown in the business's own timezone — never the device's, so "today"
 * means the same thing to everyone looking at the same business. */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/** U1b-3b-3: the one place a stock quantity turns into on-screen text. A raw base-unit amount
 * (`500` g, `3200` ml) must never reach a screen directly — always through this, so it reads as
 * `0.5 kg` / `3.2 L` instead. Pass `display` when the API already rolled the value up (most
 * endpoints do, via `display_quantity`/`display_unit` or the plural `display_*` fields on a
 * gap line); otherwise this falls back to computing it client-side with the shared units module. */
export function formatQty(
  quantity: string | number | null,
  unit: string,
  display?: { quantity: string | number | null; unit: string },
): string {
  if (display) {
    if (display.quantity === null || display.quantity === undefined) return '—';
    return `${display.quantity} ${display.unit}`;
  }
  if (quantity === null || quantity === undefined) return '—';
  const num = typeof quantity === 'string' ? Number(quantity) : quantity;
  if (!Number.isFinite(num)) return '—';
  const [value, resolvedUnit] = displayQuantity(num, unit);
  return `${formatIndianNumber(value)} ${resolvedUnit}`;
}

/** A per-unit price (`usual_price`, `unit_cost_at_entry`, ...), always shown per kg/L for a
 * weight/volume item — never the raw per-gram/per-ml figure that's actually stored. Pass
 * `displayPrice` when the API already converted it; otherwise falls back to the shared units
 * module, same rule as `formatQty`. */
export function formatPricePerUnit(
  basePrice: string | number | null,
  unit: string,
  displayPrice?: string | number | null,
): string {
  if (displayPrice !== undefined && displayPrice !== null) {
    return formatRupees(displayPrice);
  }
  if (basePrice === null || basePrice === undefined) return '—';
  const num = typeof basePrice === 'string' ? Number(basePrice) : basePrice;
  if (!Number.isFinite(num)) return '—';
  const perMajorUnit = displayPricePerMajorUnit(num, unit);
  return perMajorUnit === null ? '—' : formatRupees(perMajorUnit);
}
