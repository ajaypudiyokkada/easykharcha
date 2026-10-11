/** Must match backend/stock/models.py's Unit choices exactly. */
export const UNITS = [
  { value: 'kg', label: 'kg' },
  { value: 'g', label: 'g' },
  { value: 'L', label: 'L' },
  { value: 'ml', label: 'ml' },
  { value: 'piece', label: 'piece' },
  { value: 'pack', label: 'pack' },
] as const;

export type UnitValue = (typeof UNITS)[number]['value'];
