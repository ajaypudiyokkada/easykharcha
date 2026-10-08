import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';

import { Cap, useSession } from '../../src/state/session';
import { usePalette } from '../../src/ui';

/**
 * Role-filtered navigation.
 *
 * Hiding a tab is a convenience, not a control: every one of these endpoints re-checks the role
 * server-side, so a user who types the URL gets a 403 rather than a screen they shouldn't see.
 *
 * **Five tabs maximum.** An Owner can reach eight screens, and putting eight tabs on a 430 pt phone
 * truncates every label to "Wasta…" / "Reque…". Each role gets the screens it opens daily; the rest
 * live one tap away under More, which lists everything the role can reach.
 */
const SCREENS = {
  home: { title: 'Home', glyph: '⌂' },
  stock: { title: 'Stock', glyph: '▤' },
  wastage: { title: 'Wastage', glyph: '⊘' },
  receive: { title: 'Receive', glyph: '↓' },
  requests: { title: 'Requests', glyph: '⇪' },
  sales: { title: 'Sales', glyph: '₹' },
  report: { title: 'Report', glyph: '◳' },
  more: { title: 'More', glyph: '⋯' },
} as const;

type ScreenName = keyof typeof SCREENS;

/** What each role actually touches during a shift. More holds the remainder. */
const TABS_BY_ROLE: Record<string, ScreenName[]> = {
  staff: ['home', 'wastage', 'more'],
  head_chef: ['home', 'stock', 'wastage', 'receive', 'more'],
  manager: ['home', 'sales', 'receive', 'requests', 'more'],
  owner: ['home', 'stock', 'sales', 'report', 'more'],
  super_admin: ['home', 'stock', 'sales', 'report', 'more'],
};

/** Capability required to reach a screen at all — the gate behind both the tab bar and More. */
export const SCREEN_CAPABILITY: Record<ScreenName, string | null> = {
  home: null,
  stock: Cap.STOCK_CAPTURE,
  wastage: Cap.WASTAGE_ADD,
  receive: Cap.RECEIVE_GOODS,
  requests: Cap.REQUEST_RAISE,
  sales: Cap.SALES_RECORD,
  report: Cap.REPORTS_VIEW,
  more: null,
};

export default function AppLayout() {
  const palette = usePalette();
  const { ready, user, tenant, can } = useSession();

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!tenant) return <Redirect href="/tenants" />;

  const role = tenant.role ?? 'staff';
  const wanted = TABS_BY_ROLE[role] ?? TABS_BY_ROLE.staff;
  // Requests is reachable by whoever may raise *or* fulfil one; the capability map only covers raise.
  const reachable = (name: ScreenName) => {
    if (name === 'requests') return can(Cap.REQUEST_RAISE) || can(Cap.REQUEST_FULFIL);
    const capability = SCREEN_CAPABILITY[name];
    return capability === null || can(capability);
  };
  const visible = new Set(wanted.filter(reachable));

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.text,
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textFaint,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          // 62 was too short: the glyph's line box plus the label overflowed and every label was
          // sliced in half on web. Keep this >= paddingTop + icon lineHeight + label + paddingBottom.
          height: 72,
          paddingTop: 8,
          paddingBottom: 10,
        },
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14 },
        tabBarIconStyle: { height: 24 },
        sceneStyle: { backgroundColor: palette.bg },
      }}
    >
      {(Object.keys(SCREENS) as ScreenName[]).map((name) => {
        const screen = SCREENS[name];
        return (
          <Tabs.Screen
            key={name}
            name={name}
            options={{
              title: screen.title,
              // href: null hides the tab but leaves the route navigable from More.
              href: visible.has(name) ? undefined : null,
              headerTitle: `${tenant.name} · ${screen.title}`,
              tabBarIcon: ({ color }) => (
                <Text style={{ color, fontSize: 18, lineHeight: 22, textAlign: 'center' }}>
                  {screen.glyph}
                </Text>
              ),
            }}
          />
        );
      })}
    </Tabs>
  );
}
