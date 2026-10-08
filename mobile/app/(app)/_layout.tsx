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
 */
const TABS = [
  { name: 'home', title: 'Home', glyph: '⌂', capability: null },
  { name: 'stock', title: 'Stock', glyph: '▤', capability: Cap.STOCK_CAPTURE },
  { name: 'wastage', title: 'Wastage', glyph: '⊘', capability: Cap.WASTAGE_ADD },
  { name: 'receive', title: 'Receive', glyph: '↓', capability: Cap.RECEIVE_GOODS },
  { name: 'sales', title: 'Sales', glyph: '₹', capability: Cap.SALES_RECORD },
  { name: 'report', title: 'Report', glyph: '◳', capability: Cap.REPORTS_VIEW },
  { name: 'more', title: 'More', glyph: '⋯', capability: null },
] as const;

export default function AppLayout() {
  const palette = usePalette();
  const { ready, user, tenant, can } = useSession();

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!tenant) return <Redirect href="/tenants" />;

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
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11 },
        sceneStyle: { backgroundColor: palette.bg },
      }}
    >
      {TABS.map((tab) => {
        const visible = tab.capability === null || can(tab.capability);
        return (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: tab.title,
              href: visible ? undefined : null,
              headerTitle: `${tenant.name} · ${tab.title}`,
              tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{tab.glyph}</Text>,
            }}
          />
        );
      })}
      {/* Requests is a tab only for the roles that can raise or fulfil one. */}
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Requests',
          href: can(Cap.REQUEST_RAISE) || can(Cap.REQUEST_FULFIL) ? undefined : null,
          headerTitle: `${tenant.name} · Requests`,
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>⇪</Text>,
        }}
      />
    </Tabs>
  );
}
