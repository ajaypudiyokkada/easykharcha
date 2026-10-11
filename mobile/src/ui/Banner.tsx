import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colours, fonts, radii, spacing } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { Body } from './Text';

export type BannerKind = 'success' | 'error' | 'warning' | 'info';

type Props = {
  kind: BannerKind;
  children: React.ReactNode;
};

const ICON_BY_KIND: Record<BannerKind, IconName> = {
  success: 'success',
  error: 'error',
  warning: 'warning',
  info: 'info',
};

const BADGE_SIZE = 28;

/**
 * `.banner` in the kit — always an icon plus words, never colour alone. The kit's info badge
 * (`--secondary` background with dark text) measures ~3.1:1 against its icon, below the 4.5:1 AA
 * minimum for the icon stroke. Fixed here by using `primary` instead: `primary` + white reaches
 * ~6:1, stays inside the ten approved colours, and reads clearly against the banner's own mint
 * background (the kit's white-on-near-white alternative would have nearly vanished).
 */
export function Banner({ kind, children }: Props) {
  const isDarkBackground = kind !== 'info';

  return (
    <View style={[styles.banner, bannerStyles[kind]]}>
      <View style={[styles.badge, kind === 'info' ? styles.infoBadge : styles.lightBadge]}>
        <Icon
          name={ICON_BY_KIND[kind]}
          size={16}
          colour={kind === 'info' ? colours.card : colours.text}
          strokeWidth={3}
        />
      </View>
      <Body style={[styles.text, isDarkBackground ? styles.lightText : null]}>{children}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  badge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightBadge: {
    backgroundColor: colours.card,
  },
  infoBadge: {
    backgroundColor: colours.primary,
  },
  text: {
    flex: 1,
    fontFamily: fonts.bodyBold,
  },
  lightText: {
    color: colours.card,
  },
});

const bannerStyles = StyleSheet.create({
  success: { backgroundColor: colours.success },
  error: { backgroundColor: colours.danger },
  warning: { backgroundColor: colours.warning },
  info: { backgroundColor: colours.mint },
});
