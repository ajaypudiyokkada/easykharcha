import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { Purchase } from '../../src/api/purchases';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { formatDateTime, formatRupees } from '../../src/format';
import { RecordPurchaseSheet } from '../../src/screens/RecordPurchaseSheet';
import { strings } from '../../src/strings';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import {
  AppShell,
  Body,
  Button,
  Card,
  ConfirmDialog,
  Heading,
  NoAccess,
  ReadError,
  Screen,
  SkeletonList,
  Small,
  Toast,
} from '../../src/ui';
import { HOME_CONTENT_WIDTH } from '../../src/ui/constants';

const s = strings.purchase;

export default function PurchaseDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!business || !id) return;
    setLoading(true);
    setFailed(false);
    authedFetch<Purchase>(`/businesses/${business.id}/purchases/${id}/`)
      .then(setPurchase)
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
  if (!can(permissions, 'purchases.view')) {
    return (
      <AppShell active="buy">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  const canEdit = can(permissions, 'purchases.edit');
  const canDelete = can(permissions, 'purchases.delete');
  const timezone = business?.timezone ?? 'Asia/Kolkata';

  async function handleDelete() {
    if (!business || !purchase) return;
    setDeleting(true);
    try {
      await authedFetch(`/businesses/${business.id}/purchases/${purchase.id}/`, {
        method: 'DELETE',
      });
      setDeleteVisible(false);
      setToast(s.deletedToast);
      router.replace('/buy');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell active="buy">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{s.detailTitle}</Heading>

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading || !purchase ? (
          <SkeletonList count={2} height={130} />
        ) : (
          <>
            <Card style={styles.summaryCard}>
              <Body style={styles.supplier}>{purchase.supplier_name ?? strings.buy.title}</Body>
              <Small style={styles.meta}>
                {formatDateTime(purchase.purchase_date_time, timezone)}
              </Small>
              <Small style={styles.meta}>{s.recordedBy(purchase.recorded_by_name)}</Small>
              {purchase.note ? <Body style={styles.note}>{purchase.note}</Body> : null}
            </Card>

            <View style={styles.list}>
              {purchase.lines.map((line) => (
                <View key={line.id} style={styles.lineRow}>
                  <View style={styles.lineMain}>
                    <Body style={styles.lineName}>{line.stock_item_name}</Body>
                    <Small style={styles.meta}>
                      {line.quantity} {line.unit} × {formatRupees(line.unit_price)}
                    </Small>
                  </View>
                  <Body style={styles.lineTotal}>{formatRupees(line.line_total)}</Body>
                </View>
              ))}
            </View>

            <View style={styles.totalRow}>
              <Body style={styles.totalLabel}>{s.total}</Body>
              <Heading level={3}>{formatRupees(purchase.total_amount)}</Heading>
            </View>

            {canEdit ? (
              <Button
                label={s.editPurchase}
                variant="secondary"
                onPress={() => setEditVisible(true)}
              />
            ) : null}
            {canDelete ? (
              <Button
                label={s.deletePurchase}
                variant="primary"
                colour={colours.danger}
                onPress={() => setDeleteVisible(true)}
              />
            ) : null}
          </>
        )}
      </Screen>

      {purchase ? (
        <RecordPurchaseSheet
          visible={editVisible}
          editingPurchase={purchase}
          onClose={() => setEditVisible(false)}
          onSaved={(updated) => {
            setEditVisible(false);
            setPurchase(updated);
            setToast(s.savedEditToast);
          }}
        />
      ) : null}

      <ConfirmDialog
        visible={deleteVisible}
        title={s.deleteConfirmTitle}
        body={s.deleteConfirmBody}
        confirmLabel={s.deletePurchase}
        cancelLabel={s.keepIt}
        onConfirm={handleDelete}
        onCancel={() => setDeleteVisible(false)}
        confirmLoading={deleting}
      />
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
  summaryCard: {
    gap: spacing.xs,
  },
  supplier: {
    fontFamily: fonts.bodyExtraBold,
  },
  meta: {
    color: colours.muted,
  },
  note: {
    marginTop: spacing.sm,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  lineMain: {
    flex: 1,
    gap: 2,
  },
  lineName: {
    fontFamily: fonts.bodyExtraBold,
  },
  lineTotal: {
    fontFamily: fonts.bodyExtraBold,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 2,
    borderTopColor: colours.mint,
  },
  totalLabel: {
    fontFamily: fonts.bodyExtraBold,
  },
});
