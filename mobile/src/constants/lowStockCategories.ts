/** Must match backend/stock/models.py's LowStockCategory choices exactly. */
export const LOW_STOCK_CATEGORIES = [
  { value: 'perishable', label: 'Perishable' },
  { value: 'fresh_semi', label: 'Fresh / semi-perishable' },
  { value: 'dry_staples', label: 'Dry staples' },
  { value: 'packaging_cleaning', label: 'Packaging and cleaning' },
] as const;

export type LowStockCategoryValue = (typeof LOW_STOCK_CATEGORIES)[number]['value'];

/** Mirrors backend/stock/low_stock.py's LOW_STOCK_CATEGORY_DEFAULT_DAYS — the default days-of-cover
 * a category uses when the item has no `low_stock_days_override`. Display only (the effective
 * threshold's real quantity is always computed server-side); keep in sync if the backend default
 * ever changes. */
export const LOW_STOCK_CATEGORY_DEFAULT_DAYS: Record<LowStockCategoryValue, number> = {
  perishable: 1,
  fresh_semi: 3,
  dry_staples: 7,
  packaging_cleaning: 14,
};
