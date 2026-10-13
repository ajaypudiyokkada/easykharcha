import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { WastageEntry, WastageListResponse } from '../src/api/wastage';
import { useAuth } from '../src/auth/AuthContext';
import { can } from '../src/auth/permissions';
import { formatDateTime, formatRupees } from '../src/format';
import { RecordWastageSheet } from '../src/screens/RecordWastageSheet';
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

const s = strings.wastage;

export default function Wastage() {
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [data, setData] = useState<WastageListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WastageEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!business) return;
    setLoading(true);
    setFailed(false);
    authedFetch<WastageListResponse>(`/businesses/${business.id}/wastage/`)
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
  const canView = can(permissions, 'wastage.view_all') || can(permissions, 'wastage.view_own');
  if (!canView) {
    return (
      <AppShell active="wastage">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  const canCreate = can(permissions, 'wastage.create');
  const canDelete = can(permissions, 'wastage.delete');
  const timezone = business?.timezone ?? 'Asia/Kolkata';

  async function handleDelete() {
    if (!business || !deleteTarget) return;
    setDeleting(true);
    try {
      await authedFetch(`/businesses/${business.id}/wastage/${deleteTarget.id}/`, {
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
    <AppShell active="wastage">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <View>
          <Heading level={1}>{s.title}</Heading>
          <Body style={styles.subtitle}>{s.subtitle}</Body>
        </View>

        {data?.summary ? (
          <View style={styles.statRow}>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.today}</Small>
              <Heading level={3}>{formatRupees(data.summary.today_value)}</Heading>
            </Card>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.last7Days}</Small>
              <Heading level={3}>{formatRupees(data.summary.last_7_days_value)}</Heading>
            </Card>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.entries}</Small>
              <Heading level={3}>{data.summary.today_entries}</Heading>
            </Card>
          </View>
        ) : null}

        {canCreate ? (
          <Button label={s.recordWastage} variant="primary" onPress={() => setSheetVisible(true)} />
        ) : null}

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading ? (
          <SkeletonList count={3} height={72} />
        ) : data && data.results.length > 0 ? (
          <View style={styles.list}>
            <Small style={styles.sectionLabel}>{s.recentWastage}</Small>
            {data.results.map((entry) => (
              <WastageRow
                key={entry.id}
                entry={entry}
                timezone={timezone}
                canDelete={canDelete}
                onDelete={() => setDeleteTarget(entry)}
              />
            ))}
          </View>
        ) : canCreate ? (
          <EmptyState
            icon="wastage"
            title={s.empty.message}
            buttonLabel={s.empty.button}
            onPress={() => setSheetVisible(true)}
          />
        ) : (
          <Body style={styles.emptyMessage}>{s.empty.message}</Body>
        )}
      </Screen>

      <RecordWastageSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        onSaved={() => {
          setSheetVisible(false);
          setToast(strings.wastageForm.savedToast);
          load();
        }}
      />

      <ConfirmDialog
        visible={Boolean(deleteTarget)}
        title={s.deleteConfirmTitle}
        body={s.deleteConfirmBody}
        confirmLabel={s.deleteWastage}
        cancelLabel={s.keepIt}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        confirmLoading={deleting}
      />
      <Toast message={toast} onHide={() => setToast(null)} />
    </AppShell>
  );
}

function WastageRow({
  entry,
  timezone,
  canDelete,
  onDelete,
}: {
  entry: WastageEntry;
  timezone: string;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const reasonLabel = strings.wastageForm.reasons[entry.reason] ?? entry.reason;
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Body style={styles.rowName}>
          {entry.stock_item_name} · {entry.quantity} {entry.unit}
        </Body>
        <Small style={styles.rowMeta}>
          {reasonLabel} · {formatDateTime(entry.recorded_at, timezone)}
        </Small>
      </View>
      {typeof entry.value === 'string' ? (
        <Body style={styles.rowValue}>{formatRupees(entry.value)}</Body>
      ) : null}
      {canDelete ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.wastage.deleteWastage}
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
  rowValue: {
    fontFamily: fonts.bodyExtraBold,
  },
  deleteButton: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyMessage: {
    color: colours.muted,
  },
});
