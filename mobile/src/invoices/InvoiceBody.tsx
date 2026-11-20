import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Invoice } from '../api/invoices';
import { strings } from '../strings';
import { colours, fonts, radii, spacing, type } from '../theme/tokens';
import { Banner, Body, Small } from '../ui';
import { billDate } from './billText';
import { formatPaise, parseScaled } from './money';
import { modeLabel } from './PaymentPicker';
import { ProofViewer } from './ProofViewer';
import { formatPhone } from './validate';

const s = strings.invoice;
const m = strings.invoice.manage;
const pay = strings.invoice.payment;
const ib = strings.importInvoice.review;

const paise = (value: string): number => parseScaled(value, 2) ?? 0;

/** The whole invoice, in full: number, date, customer name and phone (when given), every item as
 * name / qty x rate / amount, and the totals as this invoice itself stored them: the Subtotal and Tax
 * rows show only when this invoice's own tax amount is above zero, with its own stored rate, never
 * today's setting. Used by the invoice detail, "Invoice created" and "already created" screens so
 * the three can't drift apart. */
export function InvoiceBody({ invoice }: { invoice: Invoice }) {
  const taxCharged = paise(invoice.tax_amount) > 0;
  const imported = invoice.source === 'imported';
  const shownLines = imported
    ? invoice.lines.filter((line) => line.kind === 'item')
    : invoice.lines;
  const [proofOpen, setProofOpen] = useState(false);
  const paid = invoice.payment_status === 'paid';
  return (
    <View style={styles.stack}>
      {invoice.proof_already_used ? <Banner kind="warning">{pay.duplicate}</Banner> : null}
      <View style={styles.card}>
        <InfoRow label={m.body.number} value={invoice.number} />
        <InfoRow label={m.body.date} value={billDate(invoice.sale_date)} />
        {invoice.customer_name ? (
          <InfoRow label={m.body.customer} value={invoice.customer_name} />
        ) : null}
        {invoice.customer_phone ? (
          <InfoRow label={m.body.phone} value={formatPhone(invoice.customer_phone)} />
        ) : null}
        <View style={styles.info}>
          <Small style={styles.muted}>{pay.title}</Small>
          <View style={styles.payRow}>
            <View style={[styles.pill, paid ? styles.pillPaid : styles.pillUnpaid]}>
              <Small style={paid ? styles.pillPaidText : styles.pillUnpaidText}>
                {paid ? pay.pillPaid(modeLabel(invoice.payment_mode)) : pay.pillUnpaid}
              </Small>
            </View>
            {invoice.proof_available ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setProofOpen(true)}
                style={styles.link}
              >
                <Small style={styles.linkText}>{pay.viewProof}</Small>
              </Pressable>
            ) : null}
            {invoice.proof_removed ? <Small style={styles.muted}>{pay.proofRemoved}</Small> : null}
          </View>
        </View>
      </View>
      <ProofViewer invoiceId={invoice.id} visible={proofOpen} onClose={() => setProofOpen(false)} />

      <View style={styles.card}>
        <Body style={styles.title}>{m.items}</Body>
        {shownLines.map((line) => (
          <View key={line.id} style={styles.line}>
            <View style={styles.flex}>
              <Body style={styles.title}>{line.name}</Body>
              <Small style={styles.muted}>
                {Number(line.quantity)} × {formatPaise(paise(line.rate ?? '0'))}
              </Small>
            </View>
            <Body style={styles.title}>
              {formatPaise(paise((imported ? line.recorded_amount : line.amount) ?? '0'))}
            </Body>
          </View>
        ))}
        <View style={styles.totals}>
          {imported ? (
            <>
              {invoice.printed_items_total !== null ? (
                <View style={styles.row}>
                  <Body style={styles.muted}>{ib.itemsTotal}</Body>
                  <Body>{formatPaise(paise(invoice.printed_items_total))}</Body>
                </View>
              ) : null}
              {paise(invoice.discount_total) > 0 ? (
                <View style={styles.row}>
                  <Body style={styles.muted}>{ib.discount}</Body>
                  <Body>−{formatPaise(paise(invoice.discount_total))}</Body>
                </View>
              ) : null}
              {invoice.tax_lines.map((tax, index) => (
                <View key={`${tax.label}${index}`} style={styles.row}>
                  <Body style={styles.muted}>{tax.label}</Body>
                  <Body>{formatPaise(paise(tax.amount ?? '0'))}</Body>
                </View>
              ))}
              {invoice.round_off !== null ? (
                <View style={styles.row}>
                  <Body style={styles.muted}>{ib.roundOff}</Body>
                  <Body>
                    {invoice.round_off.startsWith('-') ? '−' : '+'}
                    {formatPaise(paise(invoice.round_off.replace('-', '')))}
                  </Body>
                </View>
              ) : null}
            </>
          ) : taxCharged ? (
            <>
              <View style={styles.row}>
                <Body style={styles.muted}>{s.subtotal}</Body>
                <Body>{formatPaise(paise(invoice.subtotal))}</Body>
              </View>
              <View style={styles.row}>
                <Body style={styles.muted}>{s.taxRow(String(Number(invoice.tax_rate)))}</Body>
                <Body>{formatPaise(paise(invoice.tax_amount))}</Body>
              </View>
            </>
          ) : null}
          <View style={styles.row}>
            <Body style={styles.title}>{s.total}</Body>
            <Body style={styles.totalValue}>{formatPaise(paise(invoice.total))}</Body>
          </View>
        </View>
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.info}>
      <Small style={styles.muted}>{label}</Small>
      <Body style={styles.title}>{value}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  card: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colours.card,
  },
  info: { gap: 2 },
  flex: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.bodyExtraBold },
  muted: { color: colours.muted },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  totals: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  pill: {
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
  },
  pillPaid: { backgroundColor: colours.mint },
  pillPaidText: { color: colours.success, fontFamily: fonts.bodyExtraBold },
  pillUnpaid: { backgroundColor: colours.background, borderWidth: 1, borderColor: colours.warning },
  pillUnpaidText: { color: colours.warning, fontFamily: fonts.bodyExtraBold },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: colours.primary, fontFamily: fonts.bodyExtraBold },
  totalValue: { fontFamily: fonts.headingBold, fontSize: type.lg },
});
