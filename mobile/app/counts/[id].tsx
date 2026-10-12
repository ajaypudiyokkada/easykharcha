import { Redirect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { CountDetail, CountDetailLine } from '../../src/api/counts';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { formatDateTime } from '../../src/format';
import { strings } from '../../src/strings';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import {
  AppShell,
  Body,
  Heading,
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

export default function CountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
                <LineCard key={line.id} line={line} />
              ))}
            </View>
          </>
        )}
      </Screen>
    </AppShell>
  );
}

function LineCard({ line }: { line: CountDetailLine }) {
  const flagged = line.state === 'not_sure' || line.confirmed_unusual;
  return (
    <View style={[styles.card, flagged ? styles.cardFlagged : null]}>
      <View style={styles.cardHead}>
        <Heading level={3}>{line.stock_item_name}</Heading>
        {line.state === 'not_sure' ? <Badge label={s.notSureBadge} /> : null}
        {line.state === 'skipped' ? <Badge label={s.skippedBadge} /> : null}
        {line.confirmed_unusual ? <Badge label={s.confirmedBadge} /> : null}
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

function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
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
});
