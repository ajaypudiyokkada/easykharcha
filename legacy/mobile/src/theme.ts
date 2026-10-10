/**
 * The EasyKharcha shell palette, plus per-tenant branding.
 *
 * A tenant supplies two colours (FOMO: Teak #B19461, Nepal #8EABC1). Everything else — surfaces, text,
 * semantic colours — comes from the shell, so one tenant's branding can never produce unreadable text.
 */
import { useColorScheme } from 'react-native';

export type Palette = {
  mode: 'light' | 'dark';
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  onPrimary: string;
  accent: string;
  danger: string;
  warning: string;
  success: string;
  info: string;
};

const LIGHT = {
  mode: 'light' as const,
  bg: '#F6F5F2',
  surface: '#FFFFFF',
  surfaceAlt: '#F0EEE9',
  border: '#DFDBD2',
  text: '#1C1A17',
  textMuted: '#5F5A52',
  textFaint: '#908A80',
  onPrimary: '#FFFFFF',
  danger: '#B3261E',
  warning: '#B26B00',
  success: '#1F6B40',
  info: '#2E5E8C',
};

const DARK = {
  mode: 'dark' as const,
  bg: '#15140F',
  surface: '#201E19',
  surfaceAlt: '#2A2722',
  border: '#3B372F',
  text: '#F2EFE8',
  textMuted: '#B3ACA0',
  textFaint: '#857E73',
  onPrimary: '#15140F',
  danger: '#F2B8B5',
  warning: '#E9B065',
  success: '#7FD1A3',
  info: '#9CC3E8',
};

export const DEFAULT_PRIMARY = '#B19461';
export const DEFAULT_ACCENT = '#8EABC1';

export function buildPalette(
  mode: 'light' | 'dark',
  primary = DEFAULT_PRIMARY,
  accent = DEFAULT_ACCENT,
): Palette {
  const base = mode === 'dark' ? DARK : LIGHT;
  return { ...base, primary, accent };
}

export function useScheme(): 'light' | 'dark' {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };

/** Minimum 44pt targets: this is used one-handed, standing up, in a kitchen. */
export const tap = { minHeight: 48 };

export const severityColour = (palette: Palette, severity: string) =>
  severity === 'high' ? palette.danger : severity === 'medium' ? palette.warning : palette.info;
