import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { can, isLimitedRole } from '../auth/permissions';
import { useMinWidth } from '../hooks/useMinWidth';
import { strings } from '../strings';
import { colours, fonts, radii, spacing, type } from '../theme/tokens';
import { NAV_SIDE_BREAKPOINT } from './constants';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';
import { Body, Small } from './Text';

export type NavKey =
  'home' | 'stock' | 'buy' | 'reports' | 'sales' | 'wastage' | 'alerts' | 'team' | 'settings';

type NavItem = {
  key: NavKey;
  label: string;
  icon: IconName;
  href: string;
  /** Undefined means "always shown to anyone who reaches the shell at all" — Home/Reports and the
   * not-yet-built Sales/Wastage/Alerts placeholders don't have a permission to check yet. */
  permission?: string;
};

function navItems(
  s: typeof strings.nav,
  limited: boolean,
): { primary: NavItem[]; more: NavItem[] } {
  if (limited) {
    return {
      primary: [
        { key: 'home', label: s.today, icon: 'home', href: '/home' },
        {
          key: 'wastage',
          label: s.wastage,
          icon: 'wastage',
          href: '/wastage',
          permission: 'wastage.create',
        },
      ],
      more: [],
    };
  }
  return {
    primary: [
      { key: 'home', label: s.home, icon: 'home', href: '/home' },
      { key: 'stock', label: s.stock, icon: 'stock', href: '/stock', permission: 'stock.view' },
      { key: 'buy', label: s.buy, icon: 'buy', href: '/buy', permission: 'purchases.view' },
      { key: 'reports', label: s.reports, icon: 'reports', href: '/reports' },
    ],
    more: [
      { key: 'sales', label: s.sales, icon: 'sales', href: '/sales' },
      {
        key: 'wastage',
        label: s.wastage,
        icon: 'wastage',
        href: '/wastage',
        permission: 'wastage.view_all',
      },
      { key: 'alerts', label: s.alerts, icon: 'alert', href: '/alerts' },
      { key: 'team', label: s.team, icon: 'team', href: '/team', permission: 'team.manage' },
      {
        key: 'settings',
        label: s.settings,
        icon: 'settings',
        href: '/settings',
        permission: 'settings.manage',
      },
    ],
  };
}

type Props = {
  active: NavKey;
  children: React.ReactNode;
};

/**
 * The inner-app chrome: a bottom tab bar on phones, a side menu from `NAV_SIDE_BREAKPOINT` up —
 * matching the approved prototype. Every screen that's part of the signed-in app (Home, Stock, Buy,
 * the "Coming soon" placeholders, ...) wraps its own content in this, the same way every screen
 * already wraps its content in `Screen`. Items only show if the signed-in user's permissions include
 * them — hiding is for neatness only, the server is the real check (see `can()`).
 */
export function AppShell({ active, children }: Props) {
  const router = useRouter();
  const { businesses } = useAuth();
  const insets = useSafeAreaInsets();
  const isWide = useMinWidth(NAV_SIDE_BREAKPOINT);
  const [moreOpen, setMoreOpen] = useState(false);

  const business = businesses[0];
  const permissions = business?.permissions ?? [];
  const { primary, more } = navItems(strings.nav, isLimitedRole(permissions));
  const visiblePrimary = primary.filter(
    (item) => !item.permission || can(permissions, item.permission),
  );
  const visibleMore = more.filter((item) => !item.permission || can(permissions, item.permission));

  function go(href: string) {
    setMoreOpen(false);
    router.push(href as Parameters<typeof router.push>[0]);
  }

  if (isWide) {
    return (
      <View style={styles.wideRoot}>
        <View style={styles.sideNav}>
          <Body style={styles.sideBrand}>{business?.name ?? 'EasyKharcha'}</Body>
          {[...visiblePrimary, ...visibleMore].map((item) => (
            <SideNavItem key={item.key} item={item} active={active === item.key} onPress={go} />
          ))}
        </View>
        <View style={styles.wideContent}>{children}</View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.content}>{children}</View>
      <View style={[styles.bottomNav, { paddingBottom: spacing.sm + insets.bottom }]}>
        {visiblePrimary.map((item) => (
          <BottomNavItem key={item.key} item={item} active={active === item.key} onPress={go} />
        ))}
        {visibleMore.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.nav.more}
            onPress={() => setMoreOpen(true)}
            style={styles.navItem}
          >
            <Icon name="more" size={22} colour={moreOpen ? colours.primary : colours.muted} />
            <Small style={moreOpen ? styles.navLabelActive : styles.navLabel}>
              {strings.nav.more}
            </Small>
          </Pressable>
        ) : null}
      </View>
      <Sheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={strings.nav.more}>
        <View style={styles.moreList}>
          {visibleMore.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              onPress={() => go(item.href)}
              style={styles.moreItem}
            >
              <View style={styles.moreIcon}>
                <Icon name={item.icon} size={20} colour={colours.primary} />
              </View>
              <Body style={styles.moreLabel}>{item.label}</Body>
              <Icon name="chevronRight" size={20} colour={colours.muted} />
            </Pressable>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

function BottomNavItem({
  item,
  active,
  onPress,
}: {
  item: NavItem;
  active: boolean;
  onPress: (href: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.label}
      onPress={() => onPress(item.href)}
      style={styles.navItem}
    >
      <Icon name={item.icon} size={22} colour={active ? colours.primary : colours.muted} />
      <Small style={active ? styles.navLabelActive : styles.navLabel}>{item.label}</Small>
    </Pressable>
  );
}

function SideNavItem({
  item,
  active,
  onPress,
}: {
  item: NavItem;
  active: boolean;
  onPress: (href: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(item.href)}
      style={[styles.sideItem, active ? styles.sideItemActive : null]}
    >
      <Icon name={item.icon} size={22} colour={active ? colours.primary : colours.text} />
      <Body style={active ? styles.sideLabelActive : styles.sideLabel}>{item.label}</Body>
    </Pressable>
  );
}

const SIDE_WIDTH = 240;
const BOTTOM_NAV_HEIGHT = 64;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingBottom: BOTTOM_NAV_HEIGHT,
  },
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: BOTTOM_NAV_HEIGHT,
    flexDirection: 'row',
    backgroundColor: colours.card,
    borderTopWidth: 2,
    borderTopColor: colours.mint,
    paddingTop: spacing.sm,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 44,
  },
  navLabel: {
    color: colours.muted,
    fontFamily: fonts.bodyExtraBold,
  },
  navLabelActive: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
  moreList: {
    gap: spacing.sm,
  },
  moreItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 58,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  moreIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colours.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreLabel: {
    flex: 1,
    fontFamily: fonts.bodyExtraBold,
  },
  wideRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  sideNav: {
    width: SIDE_WIDTH,
    borderRightWidth: 2,
    borderRightColor: colours.mint,
    backgroundColor: colours.card,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  sideBrand: {
    fontFamily: fonts.headingBold,
    fontSize: type.lg,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.md,
  },
  sideItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 50,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
  },
  sideItemActive: {
    backgroundColor: colours.mint,
  },
  sideLabel: {
    color: colours.text,
    fontFamily: fonts.bodyExtraBold,
  },
  sideLabelActive: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
  wideContent: {
    flex: 1,
    minWidth: 0,
  },
});
