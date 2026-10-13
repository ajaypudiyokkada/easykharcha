import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type {
  BiggestGaps,
  MoneyWent,
  MoneyWentBucket,
  PriceTrend,
  ReportPeriod,
  ReportsSummary,
  SalesVsCost,
  UsedVsExpected,
  WastageTrend,
} from '../src/api/reports';
import { useAuth } from '../src/auth/AuthContext';
import { can } from '../src/auth/permissions';
import { formatDate, formatRupees } from '../src/format';
import { strings } from '../src/strings';
import { colours, fonts, radii, spacing } from '../src/theme/tokens';
import {
  AppShell,
  BarChart,
  Body,
  Button,
  Card,
  type ChartSeries,
  EmptyState,
  Heading,
  LineChart,
  NoAccess,
  ReadError,
  Screen,
  Small,
  SkeletonList,
} from '../src/ui';
import { HOME_CONTENT_WIDTH, MIN_TOUCH_TARGET } from '../src/ui/constants';

const s = strings.reports;
const PERIODS: ReportPeriod[] = ['today', '7d', '30d', '90d'];

function pushRoute(router: ReturnType<typeof useRouter>, route: string) {
  router.push(route as Parameters<typeof router.push>[0]);
}

export default function Reports() {
  const router = useRouter();
  const params = useLocalSearchParams<{ period?: string }>();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];
  const timezone = business?.timezone ?? 'Asia/Kolkata';

  const requestedPeriod = params.period;
  const [period, setPeriod] = useState<ReportPeriod>(
    (PERIODS as string[]).includes(requestedPeriod ?? '')
      ? (requestedPeriod as ReportPeriod)
      : '7d',
  );
  const [priceItem, setPriceItem] = useState<number | null>(null);
  const [data, setData] = useState<ReportsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!business) return;
    setLoading(true);
    setFailed(false);
    const itemQuery = priceItem ? `&item=${priceItem}` : '';
    authedFetch<ReportsSummary>(
      `/businesses/${business.id}/reports/summary/?period=${period}${itemQuery}`,
    )
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [business, period, priceItem, authedFetch]);

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
  if (!can(permissions, 'reports.view')) {
    return (
      <AppShell active="reports">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  const hasAnyData =
    !!data &&
    (data.money_went.buckets.some(
      (b) => Number(b.bought) || Number(b.wastage_value) || Number(b.gap_value),
    ) ||
      data.used_vs_expected.items.length > 0 ||
      data.price_trend.items.length > 0 ||
      Number(data.sales_vs_cost.total.sales) > 0 ||
      data.biggest_gaps.items.length > 0);

  return (
    <AppShell active="reports">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{s.title}</Heading>

        <View style={styles.chipRow}>
          {PERIODS.map((key) => {
            const active = period === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={s.periods[key]}
                onPress={() => {
                  setPriceItem(null);
                  setPeriod(key);
                }}
                style={[styles.chip, active ? styles.chipActive : null]}
              >
                <Small style={active ? styles.chipTextActive : styles.chipText}>
                  {s.periods[key]}
                </Small>
              </Pressable>
            );
          })}
        </View>

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading || !data ? (
          <SkeletonList count={3} height={220} />
        ) : !hasAnyData ? (
          <EmptyState
            icon="reports"
            title={s.empty.message}
            buttonLabel={s.empty.button}
            onPress={() => pushRoute(router, '/buy')}
          />
        ) : (
          <>
            <MoneyWentCard
              data={data.money_went}
              timezone={timezone}
              onViewPurchases={() => pushRoute(router, '/buy')}
            />
            <UsedVsExpectedCard
              data={data.used_vs_expected}
              onReviewCounts={() => pushRoute(router, '/counts')}
            />
            <WastageTrendCard
              data={data.wastage_trend}
              timezone={timezone}
              onViewWastage={() => pushRoute(router, '/wastage')}
            />
            <PriceTrendCard
              data={data.price_trend}
              timezone={timezone}
              selectedId={priceItem}
              onSelectItem={setPriceItem}
              onOpenItem={(id) => pushRoute(router, `/stock/${id}`)}
            />
            <SalesVsCostCard
              data={data.sales_vs_cost}
              timezone={timezone}
              onViewSales={() => pushRoute(router, '/sales')}
            />
            <BiggestGapsCard
              data={data.biggest_gaps}
              onReviewCounts={() => pushRoute(router, '/counts')}
              onOpenItem={(id) => pushRoute(router, `/stock/${id}`)}
            />
          </>
        )}
      </Screen>
    </AppShell>
  );
}

function MoneyWentCard({
  data,
  timezone,
  onViewPurchases,
}: {
  data: MoneyWent;
  timezone: string;
  onViewPurchases: () => void;
}) {
  const t = s.moneyWent;
  const xLabels = data.buckets.map((b) => formatDate(b.start, timezone));
  const series: ChartSeries[] = [
    {
      key: 'bought',
      label: t.seriesBought,
      colour: colours.primary,
      fill: 'solid',
      values: data.buckets.map((b) => Number(b.bought)),
    },
    {
      key: 'wastage',
      label: t.seriesWastage,
      colour: colours.highlight,
      fill: 'striped',
      values: data.buckets.map((b) => Number(b.wastage_value)),
    },
    {
      key: 'gap',
      label: t.seriesGap,
      colour: colours.danger,
      fill: 'dotted',
      values: data.buckets.map((b) => Number(b.gap_value)),
    },
  ];

  const totals = {
    bought: Number(data.total.bought),
    wastage: Number(data.total.wastage_value),
    gap: Number(data.total.gap_value),
  };
  const dominant =
    totals.bought >= totals.wastage && totals.bought >= totals.gap
      ? t.seriesBought.toLowerCase()
      : totals.wastage >= totals.gap
        ? t.seriesWastage.toLowerCase()
        : t.seriesGap.toLowerCase();
  let gapDayLabel: string | null = null;
  let maxGap = 0;
  for (const bucket of data.buckets as MoneyWentBucket[]) {
    const gapValue = Number(bucket.gap_value);
    if (gapValue > maxGap) {
      maxGap = gapValue;
      gapDayLabel = formatDate(bucket.start, timezone);
    }
  }
  const takeaway =
    totals.bought + totals.wastage + totals.gap > 0 ? t.takeaway(dominant, gapDayLabel) : null;

  return (
    <View style={styles.cardWrap}>
      <BarChart
        title={t.title}
        unit={t.unit}
        mode="stacked"
        xLabels={xLabels}
        series={series}
        valuePrefix="₹"
        takeawayText={takeaway}
        formatValue={formatRupees}
        emptyMessage={t.emptyMessage}
      />
      <Button label={t.button} variant="link" onPress={onViewPurchases} />
    </View>
  );
}

function UsedVsExpectedCard({
  data,
  onReviewCounts,
}: {
  data: UsedVsExpected;
  onReviewCounts: () => void;
}) {
  const t = s.usedVsExpected;
  const xLabels = data.items.map((item) => item.name);
  const series: ChartSeries[] = [
    {
      key: 'used',
      label: t.seriesUsed,
      colour: colours.primary,
      fill: 'solid',
      values: data.items.map((item) => Number(item.used)),
    },
    {
      key: 'expected',
      label: t.seriesExpected,
      colour: colours.secondary,
      fill: 'solid',
      values: data.items.map((item) => Number(item.expected)),
    },
  ];
  const biggest = data.items[0];
  // gap_qty, not gap_value — an item with no purchase price yet (or only a usual_price) still has
  // a real quantity gap, but its rupee value computes to 0, which would otherwise read as "no gap".
  const takeaway =
    biggest && Number(biggest.gap_qty) !== 0
      ? t.takeaway(
          biggest.name,
          String(Math.abs(Number(biggest.gap_qty))),
          biggest.unit,
          formatRupees(Math.abs(Number(biggest.gap_value))),
        )
      : t.noGapsTakeaway;

  return (
    <View style={styles.cardWrap}>
      <BarChart
        title={t.title}
        unit={t.unit}
        mode="grouped"
        xLabels={xLabels}
        series={series}
        takeawayText={takeaway}
        formatValue={(value) => String(value)}
        emptyMessage={t.emptyMessage}
      />
      <Button label={t.button} variant="link" onPress={onReviewCounts} />
    </View>
  );
}

function WastageTrendCard({
  data,
  timezone,
  onViewWastage,
}: {
  data: WastageTrend;
  timezone: string;
  onViewWastage: () => void;
}) {
  const t = s.wastageTrend;
  const xLabels = data.buckets.map((b) => formatDate(b.start, timezone));
  const series: ChartSeries[] = [
    {
      key: 'value',
      label: t.seriesValue,
      colour: colours.primary,
      marker: 'circle',
      values: data.buckets.map((b) => Number(b.value)),
    },
  ];
  const takeaway =
    data.change_pct !== null
      ? t.takeawayChange(
          String(Math.abs(Number(data.change_pct))),
          Number(data.change_pct) < 0 ? 'down' : 'up',
        )
      : t.takeawayFlat(formatRupees(data.total.value));

  return (
    <View style={styles.cardWrap}>
      <LineChart
        title={t.title}
        unit={t.unit}
        xLabels={xLabels}
        series={series}
        valuePrefix="₹"
        takeawayText={takeaway}
        formatValue={formatRupees}
        emptyMessage={t.emptyMessage}
      />
      <Button label={t.button} variant="link" onPress={onViewWastage} />
    </View>
  );
}

function PriceTrendCard({
  data,
  timezone,
  selectedId,
  onSelectItem,
  onOpenItem,
}: {
  data: PriceTrend;
  timezone: string;
  selectedId: number | null;
  onSelectItem: (id: number) => void;
  onOpenItem: (id: number) => void;
}) {
  const t = s.priceTrend;
  const xLabels = data.points.map((point) => formatDate(point.date, timezone));
  const series: ChartSeries[] = data.item
    ? [
        {
          key: 'price',
          label: data.item.name,
          colour: colours.primary,
          marker: 'circle',
          values: data.points.map((point) => Number(point.unit_price)),
        },
      ]
    : [];
  const takeaway =
    data.item && data.pct_change !== null
      ? t.takeaway(
          data.item.name,
          Number(data.pct_change) >= 0 ? 'more' : 'less',
          String(Math.abs(Number(data.pct_change))),
        )
      : null;
  const activeId = selectedId ?? data.item?.id ?? null;

  return (
    <View style={styles.cardWrap}>
      {data.items.length > 0 ? (
        <View style={styles.chipRow}>
          {data.items.map((item) => {
            const active = activeId === item.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.name}
                onPress={() => onSelectItem(item.id)}
                style={[styles.chip, active ? styles.chipActive : null]}
              >
                <Small style={active ? styles.chipTextActive : styles.chipText}>{item.name}</Small>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <LineChart
        title={t.title}
        unit={t.unit}
        xLabels={xLabels}
        series={series}
        valuePrefix="₹"
        takeawayText={takeaway}
        formatValue={formatRupees}
        emptyMessage={t.emptyMessage}
      />
      {data.item ? (
        <Button
          label={t.button(data.item.name)}
          variant="link"
          onPress={() => onOpenItem(data.item!.id)}
        />
      ) : null}
    </View>
  );
}

function SalesVsCostCard({
  data,
  timezone,
  onViewSales,
}: {
  data: SalesVsCost;
  timezone: string;
  onViewSales: () => void;
}) {
  const t = s.salesVsCost;
  const xLabels = data.buckets.map((b) => formatDate(b.start, timezone));
  const targetPct = Number(data.target_cost_pct);
  const series: ChartSeries[] = [
    {
      key: 'sales',
      label: t.seriesSales,
      colour: colours.primary,
      marker: 'circle',
      values: data.buckets.map((b) => Number(b.sales)),
    },
    {
      key: 'cost',
      label: t.seriesCost,
      colour: colours.secondary,
      marker: 'square',
      values: data.buckets.map((b) => Number(b.cost)),
    },
  ];
  const dashedSeries: ChartSeries = {
    key: 'target',
    label: t.seriesTarget,
    colour: colours.highlight,
    values: data.buckets.map((b) => (Number(b.sales) * targetPct) / 100),
  };
  // target_cost_pct is a settings field stored to 2 decimals ("30.00"); cost_pct is quantized to 1
  // ("31.4") — round both to the same precision so the takeaway never reads "31.4% ... 30.00%".
  const takeaway = data.cost_pct !== null ? t.takeaway(data.cost_pct, targetPct.toFixed(1)) : null;

  return (
    <View style={styles.cardWrap}>
      <LineChart
        title={t.title}
        unit={t.unit}
        xLabels={xLabels}
        series={series}
        dashedSeries={dashedSeries}
        valuePrefix="₹"
        takeawayText={takeaway}
        formatValue={formatRupees}
        emptyMessage={t.emptyMessage}
      />
      {data.coverage_pct !== null ? (
        <Small style={styles.muted}>{t.coverage(data.coverage_pct)}</Small>
      ) : null}
      <Button label={t.button} variant="link" onPress={onViewSales} />
    </View>
  );
}

function BiggestGapsCard({
  data,
  onReviewCounts,
  onOpenItem,
}: {
  data: BiggestGaps;
  onReviewCounts: () => void;
  onOpenItem: (id: number) => void;
}) {
  const t = s.biggestGaps;
  return (
    <Card style={styles.listCard}>
      <Heading level={3}>{t.title}</Heading>
      {data.items.length === 0 ? (
        <Body style={styles.muted}>{t.empty}</Body>
      ) : (
        <View style={styles.list}>
          {data.items.map((item) => (
            <Pressable
              key={item.stock_item}
              accessibilityRole="button"
              accessibilityLabel={item.name}
              style={styles.gapRow}
              onPress={() => onOpenItem(item.stock_item)}
            >
              <Body style={styles.gapName}>{item.name}</Body>
              <Small style={styles.muted}>
                {item.quantity} {item.unit}
              </Small>
              <Body style={styles.gapValue}>{formatRupees(item.value)}</Body>
            </Pressable>
          ))}
        </View>
      )}
      <Button label={t.button} variant="link" onPress={onReviewCounts} />
    </Card>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  chipRow: {
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
  cardWrap: {
    gap: spacing.sm,
  },
  muted: {
    color: colours.muted,
  },
  listCard: {
    gap: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  gapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  gapName: {
    flex: 1,
    fontFamily: fonts.bodyExtraBold,
  },
  gapValue: {
    fontFamily: fonts.bodyExtraBold,
  },
});
