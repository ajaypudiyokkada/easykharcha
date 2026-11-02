import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { Sale, SaleListResponse } from '../src/api/sales';
import { useAuth } from '../src/auth/AuthContext';
import { can } from '../src/auth/permissions';
import { formatDate, formatDateTime, formatRupees } from '../src/format';
import { strings } from '../src/strings';
import { colours, fonts, radii, spacing } from '../src/theme/tokens';
import {
  AppShell,
  Body,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Heading,
  Icon,
  NoAccess,
  ReadError,
  Screen,
  SkeletonList,
  Small,
  Toast,
} from '../src/ui';
import { HOME_CONTENT_WIDTH } from '../src/ui/constants';

const s = strings.sales;

function businessToday(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export default function Sales() {
  const router = useRouter();
  const params = useLocalSearchParams<{ saved?: string; date?: string }>();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];
  const timezone = business?.timezone ?? 'Asia/Kolkata';
  const today = businessToday(timezone);

  const [date, setDate] = useState(today);
  const [data, setData] = useState<SaleListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Sale | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!business) return;
    setLoading(true);
    setFailed(false);
    authedFetch<SaleListResponse>(
      `/businesses/${business.id}/sales/?date_from=${date}&date_to=${date}`,
    )
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [business, date, authedFetch]);

  useEffect(() => {
    load();
  }, [load]);

  // Returning here from the Record a sale hub after a save — restore the date being viewed when
  // the hub was opened and show the same toast the inline sheet used to show. Doesn't strip the
  // query params immediately — replacing the URL right away can remount this screen before the
  // toast state it just set has painted, losing it.
  useEffect(() => {
    if (!params.saved && !params.date) return;
    if (params.date) setDate(params.date);
    if (params.saved === 'sales') setToast(strings.salesForm.savedToast);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.saved, params.date]);

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
  if (!can(permissions, 'sales.view')) {
    return (
      <AppShell active="sales">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  const canRecord = can(permissions, 'sales.create');
  const canDelete = can(permissions, 'sales.delete');
  const isToday = date === today;

  async function handleDelete() {
    if (!business || !deleteTarget) return;
    setDeleting(true);
    try {
      await authedFetch(`/businesses/${business.id}/sales/${deleteTarget.id}/`, {
        method: 'DELETE',
      });
      setDeleteTarget(null);
      setToast(s.deletedToast);
      load();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell active="sales">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <View>
          <Heading level={1}>{s.title}</Heading>
          <Body style={styles.subtitle}>{s.subtitle}</Body>
        </View>

        {data?.summary ? (
          <View style={styles.statRow}>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.today}</Small>
              <Heading level={3}>{formatRupees(data.summary.sales_today)}</Heading>
            </Card>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.itemsSold}</Small>
              <Heading level={3}>{data.summary.items_sold_today}</Heading>
            </Card>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.lastUpdateLabel}</Small>
              <Heading level={3}>
                {data.summary.last_update_at
                  ? formatDateTime(data.summary.last_update_at, timezone)
                  : s.noUpdatesYet}
              </Heading>
            </Card>
          </View>
        ) : null}

        {canRecord ? (
          <Button
            label={s.recordSales}
            variant="primary"
            onPress={() => router.push(`/record-sale?returnTo=sales&date=${date}`)}
          />
        ) : null}

        <View style={styles.dateSwitcher}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.changeDate}
            style={styles.dateArrow}
            onPress={() => setDate((d) => addDays(d, -1))}
          >
            <Icon name="back" size={18} colour={colours.text} />
          </Pressable>
          <Small style={styles.dateLabel}>
            {isToday ? s.todaysSales : formatDate(date, timezone)}
          </Small>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.changeDate}
            style={[styles.dateArrow, isToday ? styles.dateArrowDisabled : null]}
            disabled={isToday}
            onPress={() => setDate((d) => addDays(d, 1))}
          >
            <Icon name="chevronRight" size={18} colour={isToday ? colours.muted : colours.text} />
          </Pressable>
        </View>

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading ? (
          <SkeletonList count={3} height={60} />
        ) : data && data.results.length > 0 ? (
          <View style={styles.list}>
            {data.results.map((sale) => (
              <SaleRow
                key={sale.id}
                sale={sale}
                canDelete={canDelete}
                onDelete={() => setDeleteTarget(sale)}
              />
            ))}
          </View>
        ) : canRecord ? (
          <EmptyState
            icon="sales"
            title={s.empty.message}
            buttonLabel={s.empty.button}
            onPress={() => router.push(`/record-sale?returnTo=sales&date=${date}`)}
          />
        ) : (
          <Body style={styles.subtitle}>{s.empty.message}</Body>
        )}
      </Screen>

      <ConfirmDialog
        visible={Boolean(deleteTarget)}
        title={s.deleteConfirmTitle}
        body={s.deleteConfirmBody}
        confirmLabel={s.deleteSale}
        cancelLabel={s.keepIt}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        confirmLoading={deleting}
      />
      <Toast
        message={toast}
        onHide={() => {
          setToast(null);
          if (params.saved || params.date) router.replace('/sales');
        }}
      />
    </AppShell>
  );
}

function SaleRow({
  sale,
  canDelete,
  onDelete,
}: {
  sale: Sale;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Body style={styles.rowName}>{sale.sell_item_name}</Body>
        <Small style={styles.rowMeta}>{sale.quantity} sold</Small>
      </View>
      <Body style={styles.rowAmount}>{formatRupees(sale.amount)}</Body>
      {canDelete ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.sales.deleteSale}
          style={styles.deleteButton}
          onPress={onDelete}
        >
          <Icon name="delete" size={18} colour={colours.danger} />
        </Pressable>
      ) : null}
    </View>
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
  dateSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  dateArrow: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.pill,
  },
  dateArrowDisabled: {
    opacity: 0.4,
  },
  dateLabel: {
    fontFamily: fonts.bodyExtraBold,
    minWidth: 120,
    textAlign: 'center',
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowName: {
    fontFamily: fonts.bodyExtraBold,
  },
  rowMeta: {
    color: colours.muted,
  },
  rowAmount: {
    fontFamily: fonts.bodyExtraBold,
  },
  deleteButton: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
