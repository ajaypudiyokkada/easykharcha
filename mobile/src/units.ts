/**
 * Step U1b-3a: the one shared unit module for every quantity-entry/display screen (purchases,
 * counts, wastage, dish ingredients, stock items) — promoted from the ingredient-only
 * `forms/unitConversion.ts`. Must match `backend/stock/units.py` exactly; `scripts/
 * check_units_parity.mjs` fails the build if the two tables drift apart. Deliberately has no
 * imports of its own (plain data + pure functions only) so that parity script can transpile and
 * evaluate this one file in isolation, same as the backend module depends on nothing app-state-ish.
 */

export const UnitFamily = {
  WEIGHT: 'weight',
  VOLUME: 'volume',
  COUNT: 'count',
} as const;

export type UnitFamilyValue = (typeof UnitFamily)[keyof typeof UnitFamily];

// Mirrors backend/stock/units.py's UNIT_FAMILY. `kg`/`L`/`tonne` are entry-only aliases — a stock
// item's own stored unit is never one of them once U1b-1's migration has run.
export const UNIT_FAMILY: Record<string, UnitFamilyValue> = {
  kg: UnitFamily.WEIGHT,
  g: UnitFamily.WEIGHT,
  tonne: UnitFamily.WEIGHT,
  L: UnitFamily.VOLUME,
  ml: UnitFamily.VOLUME,
};

export const BASE_UNIT_FOR_FAMILY: Record<string, string> = {
  [UnitFamily.WEIGHT]: 'g',
  [UnitFamily.VOLUME]: 'ml',
};

export function unitFamily(unit: string): UnitFamilyValue {
  return UNIT_FAMILY[unit] ?? UnitFamily.COUNT;
}

export function baseUnitFor(unit: string): string {
  const family = unitFamily(unit);
  return BASE_UNIT_FOR_FAMILY[family] ?? unit;
}

// Step U1b-2 (backend): generic "packaged" entry-unit labels, only meaningful for a weight/volume
// item that has set `pack_size_base_qty` — never applied to a count-family item.
export const PACK_ENTRY_UNITS = new Set(['packet', 'bag', 'tin', 'bottle', 'box']);

// A weight/volume item's own base unit plus every entry-only alias that converts cleanly to it.
const FAMILY_ENTRY_FACTORS: Record<string, Record<string, number>> = {
  [UnitFamily.WEIGHT]: { g: 1, kg: 1000, tonne: 1000000 },
  [UnitFamily.VOLUME]: { ml: 1, L: 1000 },
};

// Base-unit storage precision (3dp, Decision 4) and price precision (4dp, Decision 1).
export const QUANTITY_DECIMALS = 3;
export const PRICE_DECIMALS = 4;
// How far a stored amount rolls up for display (1,000 g -> kg, 1,000 ml -> L) and back.
export const MAJOR_UNIT_FOR_FAMILY: Record<string, string> = {
  [UnitFamily.WEIGHT]: 'kg',
  [UnitFamily.VOLUME]: 'L',
};
export const MAJOR_UNIT_FACTOR = 1000;

export class UnitEntryError extends Error {}

/** The minimal stock-item shape every function below needs — a real StockItem satisfies this. */
export type UnitStockItem = {
  unit: string;
  unit_family: string;
  pack_size_base_qty: string | number | null;
};

/** Every entry unit this stock item accepts, mapped to its "how many base units is one of these"
 * factor — mirrors backend's `entry_units_for`. A count-family item (or a weight/volume item with
 * no pack size set) only ever accepts its own unit, factor 1. */
export function entryUnitsFor(stockItem: UnitStockItem): Record<string, number> {
  const factors = { ...(FAMILY_ENTRY_FACTORS[stockItem.unit_family] ?? {}) };
  if (Object.keys(factors).length === 0) {
    return { [stockItem.unit]: 1 };
  }
  const packSize = Number(stockItem.pack_size_base_qty);
  if (stockItem.pack_size_base_qty && Number.isFinite(packSize)) {
    for (const packUnit of PACK_ENTRY_UNITS) factors[packUnit] = packSize;
  }
  return factors;
}

function unitErrorMessage(unit: string, stockItem: UnitStockItem): string {
  if (
    PACK_ENTRY_UNITS.has(unit) &&
    (stockItem.unit_family === UnitFamily.WEIGHT || stockItem.unit_family === UnitFamily.VOLUME)
  ) {
    return 'Set this item’s pack size before entering packets/bags/tins/bottles.';
  }
  const allowed = Object.keys(entryUnitsFor(stockItem)).sort().join(', ');
  return `Enter this item's quantity in one of: ${allowed}.`;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** A typed quantity, in `entryUnit` (null/undefined means "already the item's own base unit"),
 * converted down to the stock item's base unit. Throws UnitEntryError for a unit this item doesn't
 * accept — same rule as the backend's `convert_entry_quantity`. */
export function convertEntryQuantity(
  quantity: number,
  entryUnit: string | null | undefined,
  stockItem: UnitStockItem,
): number {
  const unit = entryUnit || stockItem.unit;
  const factors = entryUnitsFor(stockItem);
  if (!(unit in factors)) throw new UnitEntryError(unitErrorMessage(unit, stockItem));
  return roundTo(quantity * factors[unit], QUANTITY_DECIMALS);
}

/** "Rs 280 per kg" -> price per base unit (e.g. per gram), same entry-unit rules as above. */
export function convertEntryPrice(
  pricePerEntryUnit: number,
  entryUnit: string | null | undefined,
  stockItem: UnitStockItem,
): number {
  const unit = entryUnit || stockItem.unit;
  const factors = entryUnitsFor(stockItem);
  if (!(unit in factors)) throw new UnitEntryError(unitErrorMessage(unit, stockItem));
  return roundTo(pricePerEntryUnit / factors[unit], PRICE_DECIMALS);
}

/** Up to 2 decimals, whole numbers shown without a trailing ".00"/".X0" — e.g. 3.2, not 3.20; 999,
 * not 999.00. Mirrors backend's `_trim`. */
function trim(value: number): number {
  const quantized = roundTo(value, 2);
  if (Number.isInteger(quantized)) return quantized;
  const tenths = roundTo(quantized, 1);
  if (quantized === tenths) return tenths;
  return quantized;
}

/** A stored base-unit amount rolled up for display: >=1,000 g/ml shows as kg/L (up to 2 decimals),
 * otherwise the plain base number. Mirrors backend's `display_quantity`. */
export function displayQuantity(baseQty: number, unit: string): [number, string] {
  const family = unitFamily(unit);
  const majorUnit = MAJOR_UNIT_FOR_FAMILY[family];
  if (majorUnit !== undefined && baseQty >= MAJOR_UNIT_FACTOR) {
    return [trim(baseQty / MAJOR_UNIT_FACTOR), majorUnit];
  }
  return [trim(baseQty), unit];
}

/** The owner-facing price — always per kg/L for a weight/volume item, unchanged for anything else.
 * Mirrors backend's `display_price_per_major_unit`. */
export function displayPricePerMajorUnit(basePrice: number | null, unit: string): number | null {
  if (basePrice === null) return null;
  const family = unitFamily(unit);
  if (family === UnitFamily.WEIGHT || family === UnitFamily.VOLUME) {
    return roundTo(basePrice * MAJOR_UNIT_FACTOR, 2);
  }
  return roundTo(basePrice, 2);
}

/** A plain-decimal parse that also accepts a comma in place of a dot ("1,5") — same tolerance the
 * old ingredient-only module gave dish amounts, now shared by every quantity field. Returns null
 * for anything that isn't a positive-or-zero plain number. */
export function parseDecimalInput(raw: string): number | null {
  const normalised = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalised)) return null;
  return Number(normalised);
}
