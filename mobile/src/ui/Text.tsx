import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { colours, fonts, type } from '../theme/tokens';

type TextProps = RNTextProps & { children: React.ReactNode };

/** `h1`/`h2`/`h3` in the kit — Poppins, the kit's three heading sizes, line-height 1.15. */
export function Heading({ level = 1, style, ...rest }: TextProps & { level?: 1 | 2 | 3 }) {
  const sizeByLevel: Record<1 | 2 | 3, TextStyle> = {
    1: { fontSize: type.xxl, fontFamily: fonts.headingBold },
    2: { fontSize: type.xl, fontFamily: fonts.heading },
    3: { fontSize: type.lg, fontFamily: fonts.heading },
  };
  return (
    <RNText
      accessibilityRole="header"
      style={[{ color: colours.text, lineHeight: type.xxl * 1.15 }, sizeByLevel[level], style]}
      {...rest}
    />
  );
}

/** Body copy — `body{font:17px/1.5 "Nunito Sans"}` in the kit. The default text size everywhere. */
export function Body({ style, ...rest }: TextProps) {
  return (
    <RNText
      style={[
        {
          color: colours.text,
          fontFamily: fonts.body,
          fontSize: type.md,
          lineHeight: type.md * 1.5,
        },
        style,
      ]}
      {...rest}
    />
  );
}

/** Smaller text at the default colour — the kit's t-sm (15px) size, used on its own (not muted). */
export function Small({ style, ...rest }: TextProps) {
  return (
    <RNText
      style={[
        {
          color: colours.text,
          fontFamily: fonts.body,
          fontSize: type.sm,
          lineHeight: type.sm * 1.5,
        },
        style,
      ]}
      {...rest}
    />
  );
}

/**
 * Muted colour at a given size — the kit's `--muted` text, e.g. `.hint`, `.card p`. Size defaults to
 * Body's 17px (that's what `.card p{color:var(--muted)}` actually is); pass `size="sm"` for the
 * hint-style 15px pairing instead.
 */
export function Muted({ size = 'md', style, ...rest }: TextProps & { size?: 'sm' | 'md' }) {
  const fontSize = size === 'sm' ? type.sm : type.md;
  return (
    <RNText
      style={[
        { color: colours.muted, fontFamily: fonts.body, fontSize, lineHeight: fontSize * 1.5 },
        style,
      ]}
      {...rest}
    />
  );
}
