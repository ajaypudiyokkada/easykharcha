import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { Invoice } from '../../src/api/invoices';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { billDate } from '../../src/invoices/billText';
import { InvoiceActions } from '../../src/invoices/InvoiceActions';
import { InvoiceItemsCard } from '../../src/invoices/InvoiceItemsCard';
import { maskPhone } from '../../src/invoices/validate';
import { strings } from '../../src/strings';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import {
  Banner,
  Body,
  Button,
  Heading,
  Icon,
  NoAccess,
  Screen,
  Sheet,
  Small,
  TextField,
} from '../../src/ui';
import { MIN_TOUCH_TARGET } from '../../src/ui/constants';

const s = strings.invoice.manage;
const LIST_PATH = '/invoices';

export default function InvoiceDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];
  const isOwner = can(permissions, 'settings.manage');

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [failed, setFailed] = useState(false);
  const [voidVisible, setVoidVisible] = useState(false);
  const [reason, setReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidFailed, setVoidFailed] = useState(false);

  const load = useCallback(() => {
    if (!business || !id) return;
    setFailed(false);
    authedFetch<Invoice>(`/businesses/${business.id}/invoices/${id}/`)
      .then(setInvoice)
      .catch(() => setFailed(true));
  }, [authedFetch, business, id]);

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
  if (!can(permissions, 'sales.create') || !business) {
    return (
      <Screen>
        <NoAccess />
      </Screen>
    );
  }

  const businessId = business.id;

  async function confirmVoid() {
    if (!invoice || voiding) return;
    setVoiding(true);
    setVoidFailed(false);
    try {
      const voided = await authedFetch<Invoice>(
        `/businesses/${businessId}/invoices/${invoice.id}/void/`,
        { method: 'POST', body: reason.trim() ? { reason: reason.trim() } : {} },
      );
      setInvoice(voided);
      setVoidVisible(false);
      setReason('');
    } catch {
      setVoidFailed(true);
    } finally {
      setVoiding(false);
    }
  }

  const voided = invoice?.status === 'void';
  const subtitleParts = invoice
    ? [
        billDate(invoice.sale_date),
        invoice.customer_name || null,
        invoice.customer_phone ? maskPhone(invoice.customer_phone) : null,
      ].filter(Boolean)
    : [];

  return (
    <Screen>
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.replace(LIST_PATH)}
            style={styles.backBtn}
          >
            <Icon name="back" size={22} colour={colours.text} />
          </Pressable>
          <View style={styles.flex}>
            <Heading level={2}>{invoice ? s.detailTitle(invoice.number) : ''}</Heading>
          </View>
          {voided ? (
            <View style={styles.voidPill}>
              <Small style={styles.voidPillText}>{s.statusVoided}</Small>
            </View>
          ) : null}
        </View>

        {failed ? (
          <View style={styles.stack}>
            <Banner kind="error">{s.detailFailed}</Banner>
            <Button label={s.tryAgain} variant="secondary" onPress={load} />
          </View>
        ) : null}
        {!invoice && !failed ? <ActivityIndicator color={colours.primary} /> : null}

        {invoice ? (
          <>
            {voided ? <Banner kind="warning">{s.voidedBanner}</Banner> : null}
            <Small style={styles.muted}>{subtitleParts.join(' · ')}</Small>

            <InvoiceItemsCard invoice={invoice} />

            {voided ? (
              <Body style={styles.muted}>{s.voidedNote}</Body>
            ) : (
              <>
                <InvoiceActions invoice={invoice} />
                {isOwner ? (
                  <Button
                    label={s.voidButton}
                    variant="secondary"
                    onPress={() => {
                      setVoidFailed(false);
                      setVoidVisible(true);
                    }}
                  />
                ) : null}
              </>
            )}
            <Button
              label={s.backToInvoices}
              variant="secondary"
              onPress={() => router.replace(LIST_PATH)}
            />
          </>
        ) : null}
      </View>

      <Sheet visible={voidVisible} onClose={() => setVoidVisible(false)} title={s.voidSheet.title}>
        <View style={styles.stack}>
          <Body>{s.voidSheet.body}</Body>
          {voidFailed ? <Banner kind="error">{s.voidSheet.failed}</Banner> : null}
          <TextField
            label={s.voidSheet.reason}
            value={reason}
            onChangeText={setReason}
            maxLength={200}
          />
          <Button
            label={s.voidSheet.confirm}
            variant="primary"
            onPress={confirmVoid}
            loading={voiding}
          />
          <Button
            label={s.voidSheet.keep}
            variant="secondary"
            onPress={() => setVoidVisible(false)}
            disabled={voiding}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  page: { gap: spacing.md },
  stack: { gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  backBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
  },
  muted: { color: colours.muted },
  voidPill: {
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colours.background,
    borderWidth: 1,
    borderColor: colours.warning,
  },
  voidPillText: { color: colours.warning, fontFamily: fonts.bodyExtraBold },
});
