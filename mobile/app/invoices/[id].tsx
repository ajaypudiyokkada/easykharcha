import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ApiError } from '../../src/api/client';

import type { Invoice } from '../../src/api/invoices';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { InvoiceActions } from '../../src/invoices/InvoiceActions';
import { InvoiceBody } from '../../src/invoices/InvoiceBody';
import { PaymentPicker, UNPAID, type PaymentValue } from '../../src/invoices/PaymentPicker';
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
const pay = strings.invoice.payment;
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
  const [payVisible, setPayVisible] = useState(false);
  const [payment, setPayment] = useState<PaymentValue>({ ...UNPAID, paid: true });
  const [payErrors, setPayErrors] = useState<{ mode?: string; proof?: string }>({});
  const [payFailed, setPayFailed] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [unpaidVisible, setUnpaidVisible] = useState(false);
  const [unpaying, setUnpaying] = useState(false);
  const [unpaidFailed, setUnpaidFailed] = useState(false);

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

  async function confirmMarkPaid() {
    if (!invoice || paying) return;
    const found: { mode?: string; proof?: string } = {};
    if (payment.mode === '') found.mode = pay.modeRequired;
    else if (payment.mode !== 'cash' && payment.proofId === null) found.proof = pay.proofRequired;
    setPayErrors(found);
    setPayFailed(null);
    if (found.mode || found.proof) return;
    setPaying(true);
    try {
      const updated = await authedFetch<Invoice>(
        `/businesses/${businessId}/invoices/${invoice.id}/mark-paid/`,
        {
          method: 'POST',
          body: {
            mode: payment.mode,
            ...(payment.mode !== 'cash' && payment.proofId !== null
              ? { proof_id: payment.proofId }
              : {}),
          },
        },
      );
      // A 200 for an invoice that was already paid just returns its current state: show that.
      setInvoice(updated);
      setPayVisible(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fieldErrors?.proof_id) {
        setPayment((current) => ({ ...current, proofId: null }));
        setPayErrors({ proof: pay.proofInvalid });
      } else if (err instanceof ApiError && err.status === 400 && err.fieldErrors?.payment_mode) {
        setPayErrors({ mode: pay.modeRequired });
      } else if (err instanceof ApiError && err.status === 409) {
        setPayFailed(pay.conflict);
      } else {
        setPayFailed(pay.markPaidFailed);
      }
    } finally {
      setPaying(false);
    }
  }

  async function confirmMarkUnpaid() {
    if (!invoice || unpaying) return;
    setUnpaying(true);
    setUnpaidFailed(false);
    try {
      const updated = await authedFetch<Invoice>(
        `/businesses/${businessId}/invoices/${invoice.id}/mark-unpaid/`,
        { method: 'POST', body: {} },
      );
      setInvoice(updated);
      setUnpaidVisible(false);
    } catch {
      setUnpaidFailed(true);
    } finally {
      setUnpaying(false);
    }
  }

  const voided = invoice?.status === 'void';
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
            <Heading level={2}>{s.detailTitle}</Heading>
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
            <InvoiceBody invoice={invoice} />

            {voided ? (
              <Body style={styles.muted}>{s.voidedNote}</Body>
            ) : (
              <>
                <InvoiceActions invoice={invoice} />
                {invoice.payment_status === 'unpaid' ? (
                  <Button
                    label={pay.markPaid}
                    variant="secondary"
                    onPress={() => {
                      setPayment({ ...UNPAID, paid: true });
                      setPayErrors({});
                      setPayFailed(null);
                      setPayVisible(true);
                    }}
                  />
                ) : isOwner ? (
                  <Button
                    label={pay.markUnpaid}
                    variant="secondary"
                    onPress={() => {
                      setUnpaidFailed(false);
                      setUnpaidVisible(true);
                    }}
                  />
                ) : null}
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

      <Sheet visible={payVisible} onClose={() => setPayVisible(false)} title={pay.markPaidTitle}>
        <View style={styles.stack}>
          {payFailed ? <Banner kind="error">{payFailed}</Banner> : null}
          <PaymentPicker
            allowUnpaid={false}
            value={payment}
            onChange={(next) => {
              setPayment(next);
              setPayErrors({});
            }}
            modeError={payErrors.mode}
            proofError={payErrors.proof}
          />
          <Button
            label={pay.markPaidConfirm}
            variant="primary"
            onPress={confirmMarkPaid}
            loading={paying}
          />
          <Button
            label={strings.invoice.manage.voidSheet.keep}
            variant="secondary"
            onPress={() => setPayVisible(false)}
            disabled={paying}
          />
        </View>
      </Sheet>

      <Sheet
        visible={unpaidVisible}
        onClose={() => setUnpaidVisible(false)}
        title={pay.unpaidTitle}
      >
        <View style={styles.stack}>
          <Body>{pay.unpaidBody}</Body>
          {unpaidFailed ? <Banner kind="error">{pay.unpaidFailed}</Banner> : null}
          <Button
            label={pay.unpaidConfirm}
            variant="primary"
            onPress={confirmMarkUnpaid}
            loading={unpaying}
          />
          <Button
            label={pay.unpaidKeep}
            variant="secondary"
            onPress={() => setUnpaidVisible(false)}
            disabled={unpaying}
          />
        </View>
      </Sheet>

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
