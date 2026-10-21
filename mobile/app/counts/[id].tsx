import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { CountDetail, CountDetailLine } from '../../src/api/counts';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { formatDate, formatDateTime, formatRupees } from '../../src/format';
import { strings } from '../../src/strings';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import {
  AppShell,
  Body,
  Heading,
  Icon,
  NoAccess,
  ReadError,
  Screen,
  Small,
  SkeletonList,
} from '../../src/ui';
import { HOME_CONTENT_WIDTH } from '../../src/ui/constants';

const s = strings.countReview;

function formatQty(value: string | null, unit: string): string {
  if (value === null) return '—';
  return `${value} ${unit}`;
}

function gapReasonText(line: CountDetailLine, timezone: string): string {
  const reason = line.gap_reason;
  if (!reason) return '';
  if (reason.code === 'sales_missing') {
    const dates = (reason.dates ?? []).map((d) => formatDate(d, timezone));
    return s.gapReason.sales_missing(dates);
  }
  if (reason.code === 'recipe_not_confirmed') {
    return s.gapReason.recipe_not_confirmed(reason.sell_items ?? []);
  }
  return s.gapReason[reason.code] as string;
}

export default function CountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [detail, setDetail] = useState<CountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!business || !id) return;
    setLoading(true);
    setFailed(false);
    authedFetch<CountDetail>(`/businesses/${business.id}/counts/${id}/`)
      .then(setDetail)
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
  if (!can(permissions, 'counts.review')) {
    return (
      <AppShell active="home">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  const timezone = business?.timezone ?? 'Asia/Kolkata';

  return (
    <AppShell active="home">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{s.detailTitle}</Heading>
        <Body style={styles.subtitle}>{s.detailSubtitle}</Body>

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading || !detail ? (
          <SkeletonList count={4} height={90} />
        ) : (
          <>
            <Small style={styles.meta}>
              {detail.count_type === 'opening'
                ? s.openingCount(detail.counted_by_name)
                : s.closingCount(detail.counted_by_name)}{' '}
              · {formatDateTime(detail.submitted_at, timezone)}
            </Small>

            <View style={styles.list}>
              {detail.lines.map((line) => (
                <LineCard key={line.id} line={line} timezone={timezone} router={router} />
              ))}
            </View>
          </>
        )}
      </Screen>
    </AppShell>
  );
}

function LineCard({
  line,
  timezone,
  router,
}: {
  line: CountDetailLine;
  timezone: string;
  router: ReturnType<typeof useRouter>;
}) {
  const notSureFlagged = line.state === 'not_sure' || line.confirmed_unusual;
  const gapFlagged = line.flagged;
  return (
    <View
      style={[
        styles.card,
        notSureFlagged ? styles.cardFlagged : null,
        gapFlagged ? styles.cardGapFlagged : null,
      ]}
    >
      <View style={styles.cardHead}>
        <Heading level={3}>{line.stock_item_name}</Heading>
        {line.state === 'not_sure' ? <Badge label={s.notSureBadge} /> : null}
        {line.state === 'skipped' ? <Badge label={s.skippedBadge} /> : null}
        {line.confirmed_unusual ? <Badge label={s.confirmedBadge} /> : null}
        {gapFlagged ? <Badge label={s.gapBadge} danger /> : null}
      </View>
      <Row label={s.countedLabel} value={formatQty(line.counted_qty, line.unit)} />
      <Row
        label={s.previousLabel}
        value={
          line.previous_counted_qty === null
            ? s.noPreviousCount
            : formatQty(line.previous_counted_qty, line.unit)
        }
      />
      {line.previous_counted_qty !== null ? (
        <>
          <Row
            label={s.boughtSinceLabel}
            value={formatQty(line.quantity_bought_since, line.unit)}
          />
          <Row
            label={s.wastedSinceLabel}
            value={formatQty(line.quantity_wasted_since, line.unit)}
          />
          <Row
            label={s.usedSinceLabel}
            value={formatQty(line.used_since_last_count, line.unit)}
            emphasise
          />
        </>
      ) : null}

      {line.gap_status === 'ok' ? (
        <>
          <Row label={s.expectedLabel} value={formatQty(line.expected_used, line.unit)} />
          <View style={styles.row}>
            <Small style={styles.rowLabel}>{s.gapLabel}</Small>
            <View style={styles.gapValueWrap}>
              {gapFlagged ? <Icon name="warning" size={16} colour={colours.danger} /> : null}
              <Body style={gapFlagged ? styles.gapValueFlagged : styles.rowValue}>
                {s.gapQty(line.gap_qty ?? '—', line.unit)}
                {line.gap_value !== null ? ` ${s.gapValue(formatRupees(line.gap_value))}` : ''}
              </Body>
            </View>
          </View>
        </>
      ) : line.gap_status === 'not_comparable' && line.gap_reason ? (
        line.gap_reason.code === 'recipe_not_confirmed' ||
        line.gap_reason.code === 'sales_missing' ? (
          <Pressable
            accessibilityRole="button"
            style={styles.gapReasonRow}
            onPress={() => {
              if (line.gap_reason?.code === 'recipe_not_confirmed') {
                const sellItems = line.gap_reason.sell_items ?? [];
                router.push(
                  sellItems.length === 1
                    ? `/settings/sell?edit=${sellItems[0].id}`
                    : '/settings/sell',
                );
              } else {
                router.push('/sales');
              }
            }}
          >
            <Small style={styles.gapReasonText}>{gapReasonText(line, timezone)}</Small>
            <Small style={styles.gapReasonLink}>
              {line.gap_reason.code === 'recipe_not_confirmed'
                ? s.gapReasonLinkSell
                : s.gapReasonLinkSales(
                    line.gap_reason.dates?.[0]
                      ? formatDate(line.gap_reason.dates[0], timezone)
                      : '',
                  )}
            </Small>
          </Pressable>
        ) : (
          <View style={styles.gapReasonRow}>
            <Small style={styles.gapReasonText}>{gapReasonText(line, timezone)}</Small>
          </View>
        )
      ) : null}
    </View>
  );
}

function Row({ label, value, emphasise }: { label: string; value: string; emphasise?: boolean }) {
  return (
    <View style={styles.row}>
      <Small style={styles.rowLabel}>{label}</Small>
      <Body style={emphasise ? styles.rowValueEmphasis : styles.rowValue}>{value}</Body>
    </View>
  );
}

function Badge({ label, danger }: { label: string; danger?: boolean }) {
  return (
    <View style={[styles.badge, danger ? styles.badgeDanger : null]}>
      <Small style={styles.badgeText}>{label}</Small>
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
  meta: {
    color: colours.muted,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardFlagged: {
    borderColor: colours.warning,
    backgroundColor: colours.mint,
  },
  cardGapFlagged: {
    borderColor: colours.danger,
    backgroundColor: colours.card,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  badge: {
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colours.warning,
  },
  badgeDanger: {
    backgroundColor: colours.danger,
  },
  badgeText: {
    color: colours.card,
    fontFamily: fonts.bodyExtraBold,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowLabel: {
    color: colours.muted,
  },
  rowValue: {},
  rowValueEmphasis: {
    fontFamily: fonts.bodyExtraBold,
  },
  gapValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  gapValueFlagged: {
    color: colours.danger,
    fontFamily: fonts.bodyExtraBold,
  },
  gapReasonRow: {
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colours.mint,
    gap: 2,
  },
  gapReasonText: {
    color: colours.muted,
  },
  gapReasonLink: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
    textDecorationLine: 'underline',
  },
});
