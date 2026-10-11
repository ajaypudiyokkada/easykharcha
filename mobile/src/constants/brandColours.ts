/**
 * Ten vibrant preset brand colours — each already verified (by hand, see businesses/colour.py's
 * white_text_contrast on the backend and theme/brand.ts's contrastRatio here) to give at least
 * 4.5:1 contrast with white text, so presets never need ensureContrast's darkening.
 */
export const BRAND_COLOUR_PRESETS = [
  '#1F6F63', // EasyKharcha green — the default
  '#4B4FB0',
  '#8E3B6E',
  '#2E6B3E',
  '#B24A2C',
  '#2B3A67',
  '#B3273C',
  '#3D5A80',
  '#A8481A',
  '#A0206B',
] as const;

export const DEFAULT_BRAND_COLOUR: string = BRAND_COLOUR_PRESETS[0];
