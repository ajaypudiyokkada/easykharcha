import type { UnitValue } from '../constants/units';

const GRAMS_PER_KG = 1000;
const ML_PER_L = 1000;

/**
 * Step 22a: the only unit conversion anywhere in the app — g<->kg and ml<->L, purely at ingredient
 * *entry* time, so an owner who thinks in grams can type "150" against a kg-denominated stock item.
 * Everything actually stored (on the server, and in every other screen) stays in the stock item's
 * own unit, same invariant as before (see backend/stock/models.py's Unit docstring) — this module
 * only ever runs client-side, before the amount is sent.
 */

/** Which units the ingredient-amount field offers for this stock item — its own unit first, plus
 * the one unit it has a real conversion to. Anything else (pieces, pack, dozen, ...) only offers
 * the stock item's own unit — there's nothing to convert it from. */
export function entryUnitsFor(stockUnit: UnitValue): UnitValue[] {
  if (stockUnit === 'kg') return ['kg', 'g'];
  if (stockUnit === 'g') return ['g', 'kg'];
  if (stockUnit === 'L') return ['L', 'ml'];
  if (stockUnit === 'ml') return ['ml', 'L'];
  return [stockUnit];
}

/** Converts a typed amount into the stock item's own unit — null when the two units aren't a known
 * convertible pair (the caller should never let that combination be picked in the first place; this
 * is a safety net, not the normal path). */
export function convertToStockUnit(
  amount: number,
  entryUnit: UnitValue,
  stockUnit: UnitValue,
): number | null {
  if (entryUnit === stockUnit) return amount;
  if (stockUnit === 'kg' && entryUnit === 'g') return amount / GRAMS_PER_KG;
  if (stockUnit === 'g' && entryUnit === 'kg') return amount * GRAMS_PER_KG;
  if (stockUnit === 'L' && entryUnit === 'ml') return amount / ML_PER_L;
  if (stockUnit === 'ml' && entryUnit === 'L') return amount * ML_PER_L;
  return null;
}

/** "= 0.15 kg" shown under the amount field once the entry unit differs from the stock item's own —
 * null when there's nothing to convert (same unit, or no conversion exists for this pair). Rounded
 * to 3 decimal places, same precision the server stores. */
export function convertedHint(
  amount: number,
  entryUnit: UnitValue,
  stockUnit: UnitValue,
): string | null {
  if (entryUnit === stockUnit) return null;
  const converted = convertToStockUnit(amount, entryUnit, stockUnit);
  if (converted === null) return null;
  const rounded = Math.round(converted * 1000) / 1000;
  return `= ${rounded} ${stockUnit}`;
}

/** A plain-decimal parse that also accepts a comma in place of a dot ("1,5") — ingredient amounts
 * are the one numeric field in the app meant to tolerate that typo instead of rejecting it, per the
 * dish form's own spec. Returns null for anything that isn't a positive-or-zero plain number. */
export function parseDecimalInput(raw: string): number | null {
  const normalised = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalised)) return null;
  return Number(normalised);
}
