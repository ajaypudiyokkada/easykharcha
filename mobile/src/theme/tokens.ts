/**
 * The only place colours, spacing, radii and type sizes are defined. Screens import from here —
 * nothing is hard-coded inline. Do not add or change colours; this list is the exact, closed set.
 */

export const colours = {
  primary: '#1F6F63',
  secondary: '#6F72C9',
  highlight: '#F28C45',
  mint: '#EAF6F2',
  background: '#FFF9F2',
  card: '#FFFFFF',
  text: '#22312E',
  muted: '#65736F',
  success: '#2F7D5A',
  warning: '#A96008',
  danger: '#B34242',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 24,
  pill: 999,
} as const;

export const type = {
  xs: 13,
  sm: 15,
  md: 17,
  lg: 20,
  xl: 26,
  xxl: 34,
} as const;

export const fonts = {
  heading: 'Poppins_600SemiBold',
  headingBold: 'Poppins_700Bold',
  body: 'NunitoSans_400Regular',
  bodyBold: 'NunitoSans_700Bold',
  // Added in Step 2, additive only (no existing value changed): the approved UI kit sets
  // font-weight:800 on buttons, field labels, status text and badges throughout. 400/600/700 alone
  // can't reach that weight.
  bodyExtraBold: 'NunitoSans_800ExtraBold',
} as const;
