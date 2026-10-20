import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { Alert, AlertListResponse } from '../../src/api/alerts';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { formatRupees } from '../../src/format';
import { strings } from '../../src/strings';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import {
  AppShell,
  Body,
  Button,
  Heading,
  NoAccess,
  ReadError,
  Screen,
  SkeletonList,
  Small,
  Toast,
} from '../../src/ui';
import { HOME_CONTENT_WIDTH } from '../../src/ui/constants';

const s = strings.alertDetail;

function numberRows(alert: Alert): { label: string; value: string }[] {
  const n = alert.numbers;
  const labels = s.numberLabels;
  switch (alert.type) {
    case 'count_late':
      return [
        {
          label: labels.count_type,
          value: n.count_type === 'opening' ? s.countTypeOpening : s.countTypeClosing,
        },
        { label: labels.minutes_late, value: `${n.minutes_late} min` },
        { label: labels.deadline_hour, value: `${n.deadline_hour}:00` },
      ];
    case 'price_rise':
      return [
        { label: labels.latest_price, value: formatRupees(String(n.latest_price)) },
        { label: labels.average_price, value: formatRupees(String(n.average_price)) },
        { label: labels.pct_increase, value: `${n.pct_increase}%` },
      ];
    case 'wastage_high':
      return [
        { label: labels.wasted_qty, value: `${n.wasted_qty} ${n.unit}` },
        { label: labels.bought_qty, value: `${n.bought_qty} ${n.unit}` },
        { label: labels.pct, value: `${n.pct}%` },
      ];
    case 'gap_flagged': {
      const rows = [{ label: labels.gap_qty, value: `${n.gap_qty} ${n.unit}` }];
      if (n.gap_value !== null) {
        rows.push({ label: labels.gap_value, value: formatRupees(String(n.gap_value)) });
      }
      if (n.expected_used !== null) {
        rows.push({ label: labels.expected_used, value: `${n.expected_used} ${n.unit}` });
      }
      return rows;
    }
    case 'expiry_soon':
      return [
        { label: labels.at_risk_qty, value: `${n.at_risk_qty} ${n.unit}` },
        { label: labels.expiry_date, value: String(n.expiry_date) },
        { label: labels.days_left, value: String(n.days_left) },
        { label: labels.value_at_risk, value: formatRupees(String(n.value_at_risk)) },
      ];
    default:
      return [];
  }
}

export default function AlertDetail() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [alert, setAlert] = useState<Alert | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!business || !key) return;
    setLoading(true);
    setFailed(false);
    authedFetch<AlertListResponse>(`/businesses/${business.id}/alerts/`)
      .then((response) => setAlert(response.results.find((item) => item.key === key) ?? null))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [business, key, authedFetch]);

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

  async function handleCheck() {
    if (!business || !alert) return;
    setChecking(true);
    try {
      await authedFetch(`/businesses/${business.id}/alerts/check/`, {
        method: 'POST',
        body: { key: alert.key },
      });
      setToast(s.checkedToast);
    } finally {
      setChecking(false);
    }
  }

  return (
    <AppShell active="alerts">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading ? (
          <SkeletonList count={2} height={90} />
        ) : alert ? (
          <>
            <Heading level={1}>{alert.title}</Heading>
            <Body style={styles.detail}>{alert.detail}</Body>

            <View style={styles.list}>
              {numberRows(alert).map((row) => (
                <View key={row.label} style={styles.row}>
                  <Small style={styles.rowLabel}>{row.label}</Small>
                  <Body style={styles.rowValue}>{row.value}</Body>
                </View>
              ))}
            </View>

            <Button
              label={alert.next_action.label}
              variant="primary"
              onPress={() =>
                router.push(alert.next_action.route as Parameters<typeof router.push>[0])
              }
            />
            <Button
              label={s.markAsChecked}
              variant="link"
              onPress={handleCheck}
              loading={checking}
            />
          </>
        ) : (
          <>
            <Heading level={1}>{s.notFoundTitle}</Heading>
            <Body style={styles.detail}>{s.notFoundBody}</Body>
            <Button
              label={s.backToAlerts}
              variant="secondary"
              onPress={() => router.replace('/alerts')}
            />
          </>
        )}
      </Screen>
      <Toast
        message={toast}
        onHide={() => {
          setToast(null);
          router.replace('/alerts');
        }}
      />
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
  detail: {
    color: colours.muted,
  },
  list: {
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowLabel: {
    color: colours.muted,
  },
  rowValue: {
    fontFamily: fonts.bodyExtraBold,
  },
});
