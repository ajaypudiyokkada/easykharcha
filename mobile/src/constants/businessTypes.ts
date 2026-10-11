/**
 * The single source for business types on the frontend — values must match
 * backend/businesses/models.py's BusinessType choices exactly, since they're sent to the API as-is.
 */
export const BUSINESS_TYPES = [
  { value: 'restaurant_cafe', label: 'Restaurant or cafe' },
  { value: 'cloud_kitchen', label: 'Cloud kitchen' },
  { value: 'bakery_sweets', label: 'Bakery or sweets' },
  { value: 'tiffin_catering', label: 'Tiffin or catering' },
  { value: 'homestay', label: 'Homestay' },
  { value: 'small_manufacturing', label: 'Small manufacturing' },
  { value: 'home_business', label: 'Home business' },
  { value: 'pack_repack_shop', label: 'Shop that packs or repacks' },
  { value: 'other', label: 'Other' },
] as const;

export type BusinessTypeValue = (typeof BUSINESS_TYPES)[number]['value'];
