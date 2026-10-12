/** Money and date formatting — Indian grouping (₹1,23,456) and the business's own timezone, not the
 * device's. Kept separate from strings.ts since these are formatters, not fixed copy. */

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
