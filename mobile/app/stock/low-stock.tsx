import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { LowStockListResponse, LowStockRow } from '../../src/api/stock';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { formatRupees } from '../../src/format';
import { groupItems } from '../../src/forms/groupItems';
import { strings } from '../../src/strings';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import {
  AppShell,
  Body,
  EmptyState,
  GroupedList,
  Heading,
  NoAccess,
  ReadError,
  Screen,
  SkeletonList,
  Small,
} from '../../src/ui';
import { HOME_CONTENT_WIDTH } from '../../src/ui/constants';

const s = strings.stock.lowStock;

export default function LowStock() {
  const router = useRouter();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [data, setData] = useState<LowStockListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!business) return;
    setLoading(true);
    setFailed(false);
    authedFetch<LowStockListResponse>(`/businesses/${business.id}/stock/low-stock/`)
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
  if (!can(permissions, 'stock.low_stock_view')) {
    return (
      <AppShell active="stock">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  const results = data?.results ?? [];
  const groups = groupItems(results as (LowStockRow & { group: string })[]);

  return (
    <AppShell active="stock">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <View>
          <Heading level={1}>{s.title}</Heading>
          <Body style={styles.subtitle}>{s.subtitle}</Body>
        </View>

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading ? (
          <SkeletonList count={3} height={100} />
        ) : results.length > 0 ? (
          <GroupedList
            groups={groups}
            getKey={(row) => row.stock_item}
            renderItem={(row) => (
              <View style={styles.row}>
                <Body style={styles.rowName}>{row.name}</Body>
                <Small style={styles.rowMeta}>
                  {s.estimateLabel(row.estimated_stock_now, row.unit)}
                </Small>
                {row.partly_unconfirmed ? (
                  <Small style={styles.rowNote}>{s.partlyUnconfirmedNote}</Small>
                ) : null}
                <Small style={styles.rowMeta}>{s.thresholdLabel(row.threshold, row.unit)}</Small>
                <Small style={styles.rowSuggested}>
                  {s.suggestedOrderLabel(row.suggested_order_qty, row.unit)}
                </Small>
                {row.shortfall_value != null ? (
                  <Small style={styles.rowMeta}>
                    {s.shortfallValueLabel(formatRupees(row.shortfall_value))}
                  </Small>
                ) : null}
              </View>
            )}
          />
        ) : (
          <EmptyState
            icon="stock"
            title={s.empty}
            buttonLabel={strings.comingSoon.goHome}
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
  row: {
    gap: 2,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowName: {
    fontFamily: fonts.bodyExtraBold,
  },
  rowMeta: {
    color: colours.muted,
  },
  rowNote: {
    color: colours.warning,
  },
  rowSuggested: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
});
