import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { getBuildVersion } from '../../src/pwa/buildVersion';
import { strings } from '../../src/strings';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import {
  AppShell,
  Body,
  Heading,
  Icon,
  NoAccess,
  Screen,
  Small,
  type IconName,
} from '../../src/ui';
import { HOME_CONTENT_WIDTH } from '../../src/ui/constants';
import { MIN_TOUCH_TARGET } from '../../src/ui/constants';

const s = strings.settings.hub;

type Row = {
  key: string;
  label: string;
  icon: IconName;
  href?: string;
  comingSoon?: boolean;
};

const BUSINESS_ROWS: Row[] = [
  { key: 'business', label: s.businessDetails, icon: 'home', href: '/settings/business' },
  { key: 'brand', label: s.brand, icon: 'settings', href: '/settings/brand' },
];

const STOCK_ROWS: Row[] = [
  { key: 'stock', label: s.whatYouBuy, icon: 'stock', href: '/settings/stock' },
  { key: 'sell', label: s.whatYouSell, icon: 'sales', href: '/settings/sell' },
  { key: 'alerts', label: s.alertRules, icon: 'alert', href: '/settings/alerts' },
  { key: 'expiry', label: s.expiryAlerts, icon: 'clock', href: '/settings/alerts' },
];

export default function SettingsHub() {
  const router = useRouter();
  const { status, user, businesses } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];
  const buildVersion = getBuildVersion();

  if (status === 'bootstrapping') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }
  if (status === 'signedOut' || !user) {
    return <Redirect href="/login" />;
  }
  if (!can(permissions, 'settings.manage')) {
    return (
      <AppShell active="settings">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  return (
    <AppShell active="settings">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{s.title}</Heading>

        <View style={styles.group}>
          <Small style={styles.groupLabel}>{s.businessGroup}</Small>
          <View style={styles.list}>
            {BUSINESS_ROWS.map((row) => (
              <SettingsRow
                key={row.key}
                row={row}
                onPress={() => row.href && router.push(row.href)}
              />
            ))}
          </View>
        </View>

        <View style={styles.group}>
          <Small style={styles.groupLabel}>{s.stockGroup}</Small>
          <View style={styles.list}>
            {STOCK_ROWS.map((row) => (
              <SettingsRow
                key={row.key}
                row={row}
                onPress={() => row.href && router.push(row.href)}
              />
            ))}
          </View>
        </View>

        {buildVersion ? <Small style={styles.version}>{s.version(buildVersion)}</Small> : null}
      </Screen>
    </AppShell>
  );
}

function SettingsRow({ row, onPress }: { row: Row; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.label}
      disabled={row.comingSoon}
      onPress={onPress}
      style={styles.row}
    >
      <View style={styles.rowIcon}>
        <Icon name={row.icon} size={20} colour={colours.primary} />
      </View>
      <Body style={styles.rowLabel}>{row.label}</Body>
      {row.comingSoon ? (
        <View style={styles.chip}>
          <Small style={styles.chipText}>{s.comingSoonChip}</Small>
        </View>
      ) : (
        <Icon name="chevronRight" size={20} colour={colours.muted} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  group: {
    gap: spacing.sm,
  },
  groupLabel: {
    color: colours.muted,
    fontFamily: fonts.bodyExtraBold,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colours.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    fontFamily: fonts.bodyExtraBold,
  },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
  },
  chipText: {
    color: colours.muted,
    fontFamily: fonts.bodyExtraBold,
  },
  version: {
    color: colours.muted,
    textAlign: 'center',
  },
});
