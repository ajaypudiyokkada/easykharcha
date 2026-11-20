import React, { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import type { Invoice, InvoiceSettings } from '../api/invoices';
import { useAuth } from '../auth/AuthContext';
import { strings } from '../strings';
import { colours, spacing } from '../theme/tokens';
import { Banner, Body, Button, Sheet, TextField } from '../ui';
import { buildBillText, buildReceiptLines, type BillBusiness } from './billText';
import { printReceipt } from './print';
import { normaliseIndianMobile } from './validate';

const s = strings.invoice.manage;

/** "Send on WhatsApp" and "Print invoice" for one invoice: shared by the success, already-created
 * and detail screens so they behave identically. Bill header details (address, phone, GSTIN) are
 * read from the invoice settings at the moment of sending/printing. */
export function InvoiceActions({ invoice }: { invoice: Invoice }) {
  const { authedFetch, businesses } = useAuth();
  const business = businesses[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneVisible, setPhoneVisible] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | undefined>();

  async function billBusiness(): Promise<BillBusiness | null> {
    if (!business) return null;
    try {
      const row = await authedFetch<InvoiceSettings>(
        `/businesses/${business.id}/invoice-settings/`,
      );
      return {
        name: business.name,
        address: row.bill_address,
        phone: row.bill_phone,
        gstin: row.bill_gstin,
      };
    } catch {
      setError(s.actionFailed);
      return null;
    }
  }

  async function sendTo(normalisedPhone: string) {
    setBusy(true);
    setError(null);
    const details = await billBusiness();
    setBusy(false);
    if (!details) return;
    const text = buildBillText(details, invoice);
    // wa.me wants the number as country code + digits, no plus sign.
    const url = `https://wa.me/${normalisedPhone.replace('+', '')}?text=${encodeURIComponent(text)}`;
    Linking.openURL(url).catch(() => setError(s.actionFailed));
  }

  function onSend() {
    if (invoice.customer_phone) {
      void sendTo(invoice.customer_phone);
    } else {
      setPhone('');
      setPhoneError(undefined);
      setPhoneVisible(true);
    }
  }

  function onSendFromSheet() {
    const normalised = normaliseIndianMobile(phone);
    // Empty is not allowed here (unlike the optional field on the form): a number is the whole point.
    if (!normalised) {
      setPhoneError(s.phoneSheet.invalid);
      return;
    }
    // Used for this send only: there is no edit endpoint for an invoice's phone, so nothing is saved.
    setPhoneVisible(false);
    void sendTo(normalised);
  }

  async function onPrint() {
    setBusy(true);
    setError(null);
    const details = await billBusiness();
    setBusy(false);
    if (!details) return;
    if (!printReceipt(buildReceiptLines(details, invoice))) setError(s.printUnavailable);
  }

  return (
    <View style={styles.stack}>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button label={s.sendWhatsApp} variant="primary" onPress={onSend} disabled={busy} />
      <Button label={s.print} variant="secondary" onPress={onPrint} disabled={busy} />

      <Sheet
        visible={phoneVisible}
        onClose={() => setPhoneVisible(false)}
        title={s.phoneSheet.title}
      >
        <View style={styles.stack}>
          <Body style={styles.muted}>{s.phoneSheet.lead}</Body>
          <TextField
            label={s.phoneSheet.label}
            value={phone}
            onChangeText={(text) => {
              setPhone(text);
              setPhoneError(undefined);
            }}
            keyboardType="phone-pad"
            maxLength={20}
            error={phoneError}
            autoFocus
          />
          <Button label={s.phoneSheet.send} variant="primary" onPress={onSendFromSheet} />
          <Button
            label={s.phoneSheet.cancel}
            variant="secondary"
            onPress={() => setPhoneVisible(false)}
          />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  muted: { color: colours.muted },
});
