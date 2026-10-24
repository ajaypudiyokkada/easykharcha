import { Redirect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { StockItemDetail } from '../../src/api/purchases';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { formatDate, formatDateTime, formatRupees } from '../../src/format';
import { RecordPurchaseSheet } from '../../src/screens/RecordPurchaseSheet';
import { StockItemSheet } from '../../src/screens/StockItemSheet';
import { strings } from '../../src/strings';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import {
  AppShell,
  Body,
  Button,
  Card,
  Heading,
  NoAccess,
  PriceChart,
  ReadError,
  Screen,
  SkeletonList,
  Small,
  Toast,
  type ChartPoint,
} from '../../src/ui';
import { HOME_CONTENT_WIDTH } from '../../src/ui/constants';

const s = strings.stock.detail;

function takeawayFor(itemName: string, points: StockItemDetail['price_points']) {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const firstValue = Number(first.unit_price);
  const lastValue = Number(last.unit_price);
  if (!Number.isFinite(firstValue) || firstValue === 0) return null;
  const pct = Math.round(Math.abs(((lastValue - firstValue) / firstValue) * 100));
  if (pct === 0) return null;
  const direction = lastValue >= firstValue ? 'more' : 'less';
  const days = Math.round(
    (new Date(last.date).getTime() - new Date(first.date).getTime()) / (24 * 60 * 60 * 1000),
  );
  const weeks = Math.round(days / 7);
  const period =
    weeks >= 1
      ? `${weeks} week${weeks === 1 ? '' : 's'} ago`
      : `${days} day${days === 1 ? '' : 's'} ago`;
  return strings.chart.takeaway(itemName, direction, pct, period);
}

export default function StockItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [item, setItem] = useState<StockItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editSheetVisible, setEditSheetVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!business || !id) return;
    setLoading(true);
    setFailed(false);
    authedFetch<StockItemDetail>(`/businesses/${business.id}/stock-items/${id}/`)
      .then(setItem)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [business, id, authedFetch]);

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
    return (
      <AppShell active="stock">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  const timezone = business?.timezone ?? 'Asia/Kolkata';
  const canRecord = can(permissions, 'purchases.create');
  const canEdit = can(permissions, 'stockitems.manage');

  const chartPoints: ChartPoint[] = item
    ? item.price_points.map((point) => ({
        label: formatDate(point.date, timezone),
        value: Number(point.unit_price),
      }))
    : [];

  return (
    <AppShell active="stock">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{s.title}</Heading>

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading || !item ? (
          <SkeletonList count={2} height={130} />
        ) : (
          <>
            <Card style={styles.factsCard}>
              <Heading level={2}>{item.name}</Heading>
              <View style={styles.factRow}>
                <Small style={styles.factLabel}>{s.usualPrice}</Small>
                <Body>
                  {item.usual_price_per_major_unit
                    ? formatRupees(item.usual_price_per_major_unit)
                    : '—'}
                </Body>
              </View>
              <View style={styles.factRow}>
                <Small style={styles.factLabel}>{s.lastPricePaid}</Small>
                <Body>
                  {item.last_unit_price_per_major_unit
                    ? formatRupees(item.last_unit_price_per_major_unit)
                    : '—'}
                </Body>
              </View>
              <View style={styles.factRow}>
                <Small style={styles.factLabel}>{s.lastPurchased}</Small>
                <Body>
                  {item.last_purchased_at ? formatDate(item.last_purchased_at, timezone) : '—'}
                </Body>
              </View>
              <View style={styles.factRow}>
                <Small style={styles.factLabel}>{s.lastCounted}</Small>
                <Body>
                  {item.last_counted_qty
                    ? `${item.last_counted_qty} ${item.unit} · ${
                        item.last_counted_at ? formatDate(item.last_counted_at, timezone) : ''
                      }`
                    : '—'}
                </Body>
              </View>
            </Card>

            <PriceChart
              title={s.priceHistory}
              unit={`₹ per ${item.unit}`}
              points={chartPoints}
              valuePrefix="₹"
              takeawayText={takeawayFor(item.name, item.price_points)}
            />

            <View>
              <Small style={styles.sectionLabel}>{s.recentPurchases}</Small>
              {item.recent_purchases.length > 0 ? (
                <View style={styles.list}>
                  {item.recent_purchases.map((purchase) => (
                    <View key={purchase.id} style={styles.purchaseRow}>
                      <Body style={styles.purchaseSupplier}>
                        {purchase.supplier_name ?? strings.buy.title}
                      </Body>
                      <Small style={styles.rowMeta}>
                        {formatDateTime(purchase.purchase_date_time, timezone)}
                      </Small>
                    </View>
                  ))}
                </View>
              ) : (
                <Small style={styles.rowMeta}>{s.noPurchasesYet}</Small>
              )}
            </View>

            {canRecord ? (
              <Button
                label={s.recordPurchase}
                variant="primary"
                onPress={() => setSheetVisible(true)}
              />
            ) : null}

            {canEdit ? (
              <Button
                label={s.editItem}
                variant="secondary"
                onPress={() => setEditSheetVisible(true)}
              />
            ) : null}
          </>
        )}
      </Screen>

      {item ? (
        <RecordPurchaseSheet
          visible={sheetVisible}
          initialStockItemId={item.id}
          onClose={() => setSheetVisible(false)}
          onSaved={() => {
            setSheetVisible(false);
            setToast(strings.purchase.savedToast);
            load();
          }}
        />
      ) : null}
      {item ? (
        <StockItemSheet
          visible={editSheetVisible}
          editingItem={item}
          // This detail page only ever loads the one item, not the whole business list — the
          // server's own name/group checks (stock/views.py) still catch anything this misses.
          existingItems={[]}
          onClose={() => setEditSheetVisible(false)}
          onSaved={(message) => {
            setEditSheetVisible(false);
            setToast(message);
            load();
          }}
        />
      ) : null}
      <Toast message={toast} onHide={() => setToast(null)} />
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
  list: {
    gap: spacing.sm,
  },
  factsCard: {
    gap: spacing.sm,
  },
  factRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  factLabel: {
    color: colours.muted,
  },
  sectionLabel: {
    color: colours.muted,
    fontFamily: fonts.bodyExtraBold,
    marginBottom: spacing.sm,
  },
  purchaseRow: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  purchaseSupplier: {
    fontFamily: fonts.bodyExtraBold,
  },
  rowMeta: {
    color: colours.muted,
  },
});
