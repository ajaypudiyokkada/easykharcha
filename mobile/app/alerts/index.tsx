import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { Alert, AlertListResponse, AlertType } from '../../src/api/alerts';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { strings } from '../../src/strings';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import {
  AppShell,
  Body,
  EmptyState,
  Heading,
  Icon,
  type IconName,
  NoAccess,
  ReadError,
  Screen,
  SkeletonList,
  Small,
} from '../../src/ui';
import { HOME_CONTENT_WIDTH, MIN_TOUCH_TARGET } from '../../src/ui/constants';

const s = strings.alerts;

const FILTERS: { key: AlertType | 'all' }[] = [
  { key: 'all' },
  { key: 'count_late' },
  { key: 'price_rise' },
  { key: 'wastage_high' },
  { key: 'gap_flagged' },
];

function alertIconFor(type: AlertType): IconName {
  switch (type) {
    case 'count_late':
      return 'clock';
    case 'price_rise':
      return 'reports';
    case 'wastage_high':
      return 'wastage';
    case 'gap_flagged':
    default:
      return 'alert';
  }
}

export default function Alerts() {
  const router = useRouter();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [data, setData] = useState<AlertListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<AlertType | 'all'>('all');

  const load = useCallback(() => {
    if (!business) return;
    setLoading(true);
    setFailed(false);
    authedFetch<AlertListResponse>(`/businesses/${business.id}/alerts/`)
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [business, authedFetch]);

  useEffect(() => {
    load();
  }, [load]);

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
  if (!can(permissions, 'alerts.view')) {
    return (
      <AppShell active="alerts">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  const results: Alert[] = data?.results ?? [];
  const visible = filter === 'all' ? results : results.filter((alert) => alert.type === filter);

  return (
    <AppShell active="alerts">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{s.title}</Heading>
        <Small style={styles.subtitle}>{s.subtitle}</Small>

        <View style={styles.filterRow}>
          {FILTERS.map((item) => {
            const count = data?.counts
              ? item.key === 'all'
                ? data.counts.total
                : data.counts[item.key]
              : 0;
            const label =
              item.key === 'all'
                ? (s.filters.all as (n: number) => string)(count)
                : `${s.filters[item.key] as string} ${count}`;
            const active = filter === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => setFilter(item.key)}
                style={[styles.chip, active ? styles.chipActive : null]}
              >
                <Small style={active ? styles.chipTextActive : styles.chipText}>{label}</Small>
              </Pressable>
            );
          })}
        </View>

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading ? (
          <SkeletonList count={3} height={90} />
        ) : visible.length > 0 ? (
          <View style={styles.list}>
            {visible.map((alert) => (
              <Pressable
                key={alert.key}
                accessibilityRole="button"
                accessibilityLabel={alert.title}
                style={styles.card}
                onPress={() =>
                  router.push({ pathname: '/alerts/[key]', params: { key: alert.key } })
                }
              >
                <View
                  style={[
                    styles.icon,
                    {
                      backgroundColor:
                        alert.severity === 'danger' ? colours.danger : colours.warning,
                    },
                  ]}
                >
                  <Icon name={alertIconFor(alert.type)} size={20} colour={colours.card} />
                </View>
                <View style={styles.cardMain}>
                  <Body style={styles.cardTitle}>{alert.title}</Body>
                  <Small style={styles.cardDetail}>{alert.detail}</Small>
                </View>
                <Icon name="chevronRight" size={20} colour={colours.muted} />
              </Pressable>
            ))}
          </View>
        ) : (
          <EmptyState
            icon="alert"
            title={s.empty.message}
            buttonLabel={s.empty.button}
            onPress={() => router.replace('/home')}
          />
        )}
      </Screen>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  subtitle: {
    color: colours.muted,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colours.mint,
  },
  chipActive: {
    backgroundColor: colours.primary,
    borderColor: colours.primary,
  },
  chipText: {
    fontFamily: fonts.bodyExtraBold,
    color: colours.text,
  },
  chipTextActive: {
    fontFamily: fonts.bodyExtraBold,
    color: colours.card,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMain: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontFamily: fonts.bodyExtraBold,
  },
  cardDetail: {
    color: colours.muted,
  },
});
