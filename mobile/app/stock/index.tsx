import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { StockItem } from '../../src/api/stock';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { formatDate, formatRupees } from '../../src/format';
import { strings } from '../../src/strings';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import {
  AppShell,
  Body,
  Heading,
  Muted,
  ReadError,
  Screen,
  Skeleton,
  Small,
  TextField,
} from '../../src/ui';
import { HOME_CONTENT_WIDTH } from '../../src/ui/constants';

const s = strings.stock;

export default function Stock() {
  const router = useRouter();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [items, setItems] = useState<StockItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    if (!business) return;
    setLoading(true);
    setFailed(false);
    authedFetch<StockItem[]>(`/businesses/${business.id}/stock-items/`)
      .then(setItems)
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
  if (!can(permissions, 'stock.view')) {
    return <Redirect href="/home" />;
  }

  const filtered = (items ?? []).filter((item) =>
    item.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const timezone = business?.timezone ?? 'Asia/Kolkata';

  return (
    <AppShell active="stock">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <View>
          <Heading level={1}>{s.title}</Heading>
          <Body style={styles.subtitle}>{s.subtitle}</Body>
        </View>

        <Muted size="sm">{s.countsNote}</Muted>

        <TextField
          label={s.searchPlaceholder}
          value={search}
          onChangeText={setSearch}
          placeholder={s.searchPlaceholder}
        />

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading ? (
          <View style={styles.list}>
            <Skeleton height={72} />
            <Skeleton height={72} />
            <Skeleton height={72} />
          </View>
        ) : filtered.length > 0 ? (
          <View style={styles.list}>
            <Small style={styles.sectionLabel}>{s.stockItems}</Small>
            {filtered.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.name}
                onPress={() => router.push(`/stock/${item.id}`)}
                style={styles.row}
              >
                <View style={styles.rowMain}>
                  <Body style={styles.rowName}>{item.name}</Body>
                  <Small style={styles.rowMeta}>
                    {item.usual_price ? s.usualPrice(formatRupees(item.usual_price)) : null}
                  </Small>
                </View>
                <View style={styles.rowSide}>
                  {item.last_unit_price ? (
                    <Small style={styles.rowPrice}>
                      {s.lastPricePaid(formatRupees(item.last_unit_price))}
                    </Small>
                  ) : (
                    <Small style={styles.rowMeta}>{s.neverPurchased}</Small>
                  )}
                  {item.last_purchased_at ? (
                    <Small style={styles.rowMeta}>
                      {formatDate(item.last_purchased_at, timezone)}
                    </Small>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <Body style={styles.emptyMessage}>{s.empty}</Body>
          </View>
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
  list: {
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colours.muted,
    fontFamily: fonts.bodyExtraBold,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 60,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontFamily: fonts.bodyExtraBold,
  },
  rowMeta: {
    color: colours.muted,
  },
  rowSide: {
    alignItems: 'flex-end',
    gap: 2,
  },
  rowPrice: {
    fontFamily: fonts.bodyExtraBold,
  },
  empty: {
    alignItems: 'flex-start',
    paddingVertical: spacing.xl,
  },
  emptyMessage: {
    color: colours.muted,
  },
});
