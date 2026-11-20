/** Invoice money maths in whole paise — never floats. Mirrors backend/invoices/service.py exactly:
 * amount = round_half_up(quantity x rate, 2dp); tax = round_half_up(subtotal x rate% / 100, 2dp);
 * total = subtotal + tax. `scripts/check_invoice_totals_parity.mjs` fails the build if the two drift. */

/** "12.5" -> 1250 with scale 2. Returns null for anything that isn't a plain non-negative decimal
 * with at most `scale` places (extra places are NOT silently dropped). */
export function parseScaled(text: string, scale: number): number | null {
  const trimmed = text.trim();
  const match = /^(\d+)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > scale) return null;
  return (
    Number(match[1]) * 10 ** scale + Number((fraction + '0'.repeat(scale)).slice(0, scale) || 0)
  );
}

/** Integer division rounding half up (all inputs here are non-negative). */
function divRoundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

/** quantity in thousandths x rate in paise -> amount in paise. */
export function lineAmountPaise(quantityMilli: number, ratePaise: number): number {
  return divRoundHalfUp(quantityMilli * ratePaise, 1000);
}

/** `taxRateHundredths` is the rate in hundredths of a percent: 5% -> 500. */
export function taxPaise(subtotalPaise: number, taxRateHundredths: number): number {
  return divRoundHalfUp(subtotalPaise * taxRateHundredths, 10000);
}

export type InvoiceTotals = { subtotal: number; tax: number; total: number };

export function invoiceTotals(
  lineAmounts: number[],
  taxEnabled: boolean,
  taxRateHundredths: number,
): InvoiceTotals {
  const subtotal = lineAmounts.reduce((sum, amount) => sum + amount, 0);
  const tax = taxEnabled ? taxPaise(subtotal, taxRateHundredths) : 0;
  return { subtotal, tax, total: subtotal + tax };
}

/** 12345 -> "123.45" (what the API sends and accepts). */
export function paiseToDecimal(paise: number): string {
  const whole = Math.floor(paise / 100);
  const cents = String(paise % 100).padStart(2, '0');
  return `${whole}.${cents}`;
}

/** 12345 -> "₹123.45", 12300 -> "₹123". Bills show paise only when there are some. */
export function formatPaise(paise: number): string {
  const whole = Math.floor(paise / 100);
  const cents = paise % 100;
  const grouped = new Intl.NumberFormat('en-IN').format(whole);
  return cents === 0 ? `₹${grouped}` : `₹${grouped}.${String(cents).padStart(2, '0')}`;
}
