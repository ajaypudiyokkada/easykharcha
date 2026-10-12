import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { Purchase, PurchaseListResponse } from '../../src/api/purchases';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { formatDateTime, formatRupees } from '../../src/format';
import { RecordPurchaseSheet } from '../../src/screens/RecordPurchaseSheet';
import { strings } from '../../src/strings';
import { colours } from '../../src/theme/tokens';
import { fonts, radii, spacing, type } from '../../src/theme/tokens';
import {
  AppShell,
  Body,
  Button,
  Card,
  Heading,
  ReadError,
  Screen,
  Skeleton,
  Small,
  TextField,
  Toast,
} from '../../src/ui';
import { HOME_CONTENT_WIDTH } from '../../src/ui/constants';

const s = strings.buy;

export default function Buy() {
  const router = useRouter();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [data, setData] = useState<PurchaseListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!business) return;
    setLoading(true);
    setFailed(false);
    const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
    authedFetch<PurchaseListResponse>(`/businesses/${business.id}/purchases/${query}`)
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [business, search, authedFetch]);

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
  if (!can(permissions, 'purchases.view')) {
    return <Redirect href="/home" />;
  }

  const canRecord = can(permissions, 'purchases.create');

  return (
    <AppShell active="buy">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <View>
          <Heading level={1}>{s.title}</Heading>
          <Body style={styles.subtitle}>{s.subtitle}</Body>
        </View>

        {data ? (
          <View style={styles.statRow}>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.today}</Small>
              <Heading level={3}>{formatRupees(data.summary.bought_today)}</Heading>
            </Card>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.last7Days}</Small>
              <Heading level={3}>{formatRupees(data.summary.last_7_days)}</Heading>
            </Card>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.suppliers}</Small>
              <Heading level={3}>{data.summary.supplier_count}</Heading>
            </Card>
          </View>
        ) : null}

        <TextField
          label={s.searchPlaceholder}
          value={search}
          onChangeText={setSearch}
          placeholder={s.searchPlaceholder}
        />

        {canRecord ? (
          <Button
            label={s.recordPurchase}
            variant="primary"
            onPress={() => setSheetVisible(true)}
          />
        ) : null}

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading ? (
          <View style={styles.list}>
            <Skeleton height={76} />
            <Skeleton height={76} />
            <Skeleton height={76} />
          </View>
        ) : data && data.results.length > 0 ? (
          <View style={styles.list}>
            <Small style={styles.sectionLabel}>{s.recentPurchases}</Small>
            {data.results.map((purchase) => (
              <PurchaseRow
                key={purchase.id}
                purchase={purchase}
                timezone={business?.timezone ?? 'Asia/Kolkata'}
                onPress={() => router.push(`/buy/${purchase.id}`)}
              />
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <Body style={styles.emptyMessage}>{s.empty.message}</Body>
            {canRecord ? (
              <Button
                label={s.empty.button}
                variant="secondary"
                onPress={() => setSheetVisible(true)}
              />
            ) : null}
          </View>
        )}
      </Screen>

      <RecordPurchaseSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        onSaved={() => {
          setSheetVisible(false);
          setToast(strings.purchase.savedToast);
          load();
        }}
      />
      <Toast message={toast} onHide={() => setToast(null)} />
    </AppShell>
  );
}

function PurchaseRow({
  purchase,
  timezone,
  onPress,
}: {
  purchase: Purchase;
  timezone: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={purchase.supplier_name ?? strings.buy.title}
      onPress={onPress}
      style={styles.row}
    >
      <View style={styles.rowMain}>
        <Body style={styles.rowSupplier}>{purchase.supplier_name ?? strings.buy.title}</Body>
        <Small style={styles.rowMeta}>
          {formatDateTime(purchase.purchase_date_time, timezone)} ·{' '}
          {strings.buy.itemsCount(purchase.lines.length)}
        </Small>
      </View>
      <Body style={styles.rowAmount}>{formatRupees(purchase.total_amount)}</Body>
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
  subtitle: {
    color: colours.muted,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  statCard: {
    flex: 1,
    gap: spacing.xs,
  },
  statLabel: {
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
  rowSupplier: {
    fontFamily: fonts.bodyExtraBold,
  },
  rowMeta: {
    color: colours.muted,
  },
  rowAmount: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: type.md,
  },
  empty: {
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  emptyMessage: {
    color: colours.muted,
  },
});
