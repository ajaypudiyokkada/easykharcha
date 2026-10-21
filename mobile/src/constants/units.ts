/** Must match backend/stock/models.py's Unit choices exactly. No conversion exists between any of
 * these (a stock item is locked to one unit for life) — adding one here is purely cosmetic. */
export const UNITS = [
  { value: 'kg', label: 'kg' },
  { value: 'g', label: 'g' },
  { value: 'L', label: 'L' },
  { value: 'ml', label: 'ml' },
  { value: 'piece', label: 'piece' },
  { value: 'pack', label: 'pack' },
  { value: 'dozen', label: 'dozen' },
  { value: 'tonne', label: 'tonne' },
  { value: 'm', label: 'm' },
  { value: 'sheet', label: 'sheet' },
  { value: 'roll', label: 'roll' },
  { value: 'set', label: 'set' },
  { value: 'box', label: 'box' },
  { value: 'bag', label: 'bag' },
  { value: 'tray', label: 'tray' },
  { value: 'bottle', label: 'bottle' },
] as const;

export type UnitValue = (typeof UNITS)[number]['value'];
