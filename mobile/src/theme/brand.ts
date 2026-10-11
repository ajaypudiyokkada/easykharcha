/**
 * Brand colours a business picks for itself — separate from `tokens.ts`, which is the app's own
 * fixed UI palette and is never touched by anything in here. Same WCAG contrast maths the server
 * repeats in businesses/colour.py: the client tries to never submit a colour that would fail the
 * server's check, but the server is the one that actually enforces it.
 */

const WHITE = '#FFFFFF';
const DARK_TEXT = '#22312E'; // tokens.ts's colours.text, repeated as a literal on purpose — see above.
const MIN_CONTRAST = 4.5;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = parseInt(hex.replace('#', ''), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA) + 0.05;
  const b = relativeLuminance(hexB) + 0.05;
  return a > b ? a / b : b / a;
}

/** White or the app's dark text colour — whichever reads clearly on `colour`. */
export function bestTextOn(colour: string): string {
  return contrastRatio(colour, WHITE) >= MIN_CONTRAST ? WHITE : DARK_TEXT;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  if (s === 0) {
    const v = l * 255;
    return rgbToHex(v, v, v);
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToChannel = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const hn = h / 360;
  return rgbToHex(
    hueToChannel(hn + 1 / 3) * 255,
    hueToChannel(hn) * 255,
    hueToChannel(hn - 1 / 3) * 255,
  );
}

export type ContrastAdjustment = {
  colour: string;
  /** True when `colour` had to be darkened to pass — tell the user what changed. */
  changed: boolean;
};

/** Darkens a custom colour, one step at a time, until white text reaches 4.5:1 against it. Preset
 * swatches are already verified to pass and never go through this. */
export function ensureContrast(colour: string): ContrastAdjustment {
  if (contrastRatio(colour, WHITE) >= MIN_CONTRAST) {
    return { colour, changed: false };
  }
  const { h, s, l } = hexToHsl(colour);
  for (let step = 1; step <= 20; step++) {
    const candidate = hslToHex(h, s, Math.max(0, l - step * 0.05));
    if (contrastRatio(candidate, WHITE) >= MIN_CONTRAST) {
      return { colour: candidate, changed: true };
    }
  }
  return { colour: DARK_TEXT, changed: true };
}
