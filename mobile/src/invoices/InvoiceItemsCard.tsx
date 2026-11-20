import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { Invoice } from '../api/invoices';
import { strings } from '../strings';
import { colours, fonts, radii, spacing, type } from '../theme/tokens';
import { Body, Small } from '../ui';
import { formatPaise, parseScaled } from './money';

const s = strings.invoice;
const m = strings.invoice.manage;

const paise = (value: string): number => parseScaled(value, 2) ?? 0;

/** The items, and the totals as this invoice itself stored them: the Subtotal and Tax rows show only
 * when this invoice's own tax amount is above zero, using its own stored rate, never today's setting. */
export function InvoiceItemsCard({ invoice }: { invoice: Invoice }) {
  const taxCharged = paise(invoice.tax_amount) > 0;
  return (
    <View style={styles.card}>
      <Body style={styles.title}>{m.items}</Body>
      {invoice.lines.map((line) => (
        <View key={line.id} style={styles.line}>
          <View style={styles.flex}>
            <Body style={styles.title}>{line.name}</Body>
            <Small style={styles.muted}>
              {Number(line.quantity)} × {formatPaise(paise(line.rate))}
            </Small>
          </View>
          <Body style={styles.title}>{formatPaise(paise(line.amount))}</Body>
        </View>
      ))}
      <View style={styles.totals}>
        {taxCharged ? (
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
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colours.card,
  },
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
  totalValue: { fontFamily: fonts.headingBold, fontSize: type.lg },
});
