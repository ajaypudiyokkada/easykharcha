import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { Invoice } from '../../src/api/invoices';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { billDate } from '../../src/invoices/billText';
import { formatPaise, parseScaled } from '../../src/invoices/money';
import { modeLabel } from '../../src/invoices/PaymentPicker';
import { maskPhone } from '../../src/invoices/validate';
import { strings } from '../../src/strings';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import { Banner, Body, Button, Heading, Icon, NoAccess, Screen, Small } from '../../src/ui';
import { MIN_TOUCH_TARGET } from '../../src/ui/constants';

const s = strings.invoice.manage;
const FORM_PATH = '/invoices/new';

type Filter = 'all' | 'posted' | 'void';
type PayFilter = 'any' | 'unpaid' | 'paid';
type SourceFilter = 'any' | 'created' | 'imported';
type Page = { count: number; next: string | null; results: Invoice[] };

const PAY_FILTERS: { key: PayFilter; label: string }[] = [
  { key: 'any', label: strings.invoice.payment.filterAny },
  { key: 'unpaid', label: strings.invoice.payment.filterUnpaid },
  { key: 'paid', label: strings.invoice.payment.filterPaid },
];

const SOURCE_FILTERS: { key: SourceFilter; label: string }[] = [
  { key: 'any', label: strings.importInvoice.list.anySource },
  { key: 'created', label: strings.importInvoice.list.createdHere },
  { key: 'imported', label: strings.importInvoice.list.fromBill },
];

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: s.filterAll },
  { key: 'posted', label: s.filterActive },
  { key: 'void', label: s.filterVoided },
];

export default function RecentInvoices() {
  const router = useRouter();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [filter, setFilter] = useState<Filter>('all');
  const [payFilter, setPayFilter] = useState<PayFilter>('any');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('any');
  const [rows, setRows] = useState<Invoice[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const businessId = business?.id;
  const load = useCallback(
    (nextPage: number, which: Filter, pay: PayFilter, source: SourceFilter) => {
      if (!businessId) return;
      setLoading(true);
      setFailed(false);
      const query =
        `page=${nextPage}` +
        (which === 'all' ? '' : `&status=${which}`) +
        (pay === 'any' ? '' : `&payment_status=${pay}`) +
        (source === 'any' ? '' : `&source=${source}`);
      authedFetch<Page>(`/businesses/${businessId}/invoices/?${query}`)
        .then((response) => {
          setRows((current) =>
            nextPage === 1 ? response.results : [...current, ...response.results],
          );
          setPage(nextPage);
          setHasMore(Boolean(response.next));
        })
        .catch(() => setFailed(true))
        .finally(() => setLoading(false));
    },
    [authedFetch, businessId],
  );

  useEffect(() => {
    setRows([]);
    load(1, filter, payFilter, sourceFilter);
  }, [filter, payFilter, sourceFilter, load]);

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

  const empty = !loading && !failed && rows.length === 0;

  return (
    <Screen>
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.replace(FORM_PATH)}
            style={styles.backBtn}
          >
            <Icon name="back" size={22} colour={colours.text} />
          </Pressable>
          <Heading level={2}>{s.listTitle}</Heading>
        </View>
        <Small style={styles.muted}>{s.listSubtitle}</Small>

        <View style={styles.chips}>
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <Pressable
                key={f.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                onPress={() => setFilter(f.key)}
                style={[styles.chip, active ? styles.chipActive : null]}
              >
                <Small style={active ? styles.chipTextActive : styles.chipText}>{f.label}</Small>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.chips}>
          {PAY_FILTERS.map((f) => {
            const active = f.key === payFilter;
            return (
              <Pressable
                key={f.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                onPress={() => setPayFilter(f.key)}
                style={[styles.chip, active ? styles.chipActive : null]}
              >
                <Small style={active ? styles.chipTextActive : styles.chipText}>{f.label}</Small>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.chips}>
          {SOURCE_FILTERS.map((f) => {
            const active = f.key === sourceFilter;
            return (
              <Pressable
                key={f.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                onPress={() => setSourceFilter(f.key)}
                style={[styles.chip, active ? styles.chipActive : null]}
              >
                <Small style={active ? styles.chipTextActive : styles.chipText}>{f.label}</Small>
              </Pressable>
            );
          })}
        </View>

        {failed ? (
          <View style={styles.stack}>
            <Banner kind="error">{s.loadFailed}</Banner>
            <Button
              label={s.tryAgain}
              variant="secondary"
              onPress={() => load(1, filter, payFilter, sourceFilter)}
            />
          </View>
        ) : null}

        {rows.map((invoice) => (
          <InvoiceRow
            key={invoice.id}
            invoice={invoice}
            onPress={() => router.push(`/invoices/${invoice.id}`)}
          />
        ))}

        {loading ? <ActivityIndicator color={colours.primary} /> : null}

        {hasMore && !loading ? (
          <Button
            label={s.loadMore}
            variant="secondary"
            onPress={() => load(page + 1, filter, payFilter, sourceFilter)}
          />
        ) : null}

        {empty ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Icon name="invoice" size={24} colour={colours.primary} />
            </View>
            <Body style={styles.title}>{s.emptyTitle}</Body>
            <Small style={styles.muted}>{s.emptyBody}</Small>
            <Button
              label={s.createInvoice}
              variant="primary"
              onPress={() => router.push(FORM_PATH)}
            />
          </View>
        ) : null}

        <Button label={s.back} variant="secondary" onPress={() => router.replace(FORM_PATH)} />
      </View>
    </Screen>
  );
}

function InvoiceRow({ invoice, onPress }: { invoice: Invoice; onPress: () => void }) {
  const voided = invoice.status === 'void';
  const paid = invoice.payment_status === 'paid';
  const imported = invoice.source === 'imported';
  const il = strings.importInvoice.list;
  const meta = (
    imported
      ? [
          billDate(invoice.sale_date),
          paid
            ? `${strings.invoice.payment.paid} · ${modeLabel(invoice.payment_mode)}`
            : il.importedMeta,
        ]
      : [
          billDate(invoice.sale_date),
          invoice.customer_name || (invoice.customer_phone ? null : s.noCustomer),
          invoice.customer_phone ? maskPhone(invoice.customer_phone) : null,
        ]
  )
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={invoice.number}
      onPress={onPress}
      style={styles.row}
    >
      <View style={styles.rowTop}>
        <Body style={[styles.title, styles.flex]}>
          {imported && invoice.bill_number_printed
            ? il.billRow(invoice.bill_number_printed)
            : invoice.number}
        </Body>
        {imported ? (
          <View style={[styles.pill, styles.pillActive]}>
            <Small style={styles.pillActiveText}>{il.fromBill}</Small>
          </View>
        ) : null}
        {imported && invoice.partly_recorded ? (
          <View style={[styles.pill, styles.pillVoid]}>
            <Small style={styles.pillVoidText}>{il.partly}</Small>
          </View>
        ) : null}
        <View style={[styles.pill, voided ? styles.pillVoid : styles.pillActive]}>
          <Small style={voided ? styles.pillVoidText : styles.pillActiveText}>
            {voided ? s.statusVoided : s.statusActive}
          </Small>
        </View>
        <View style={[styles.pill, paid ? styles.pillActive : styles.pillVoid]}>
          <Small style={paid ? styles.pillActiveText : styles.pillVoidText}>
            {paid ? strings.invoice.payment.paid : strings.invoice.payment.unpaid}
          </Small>
        </View>
      </View>
      <Small style={styles.muted}>{meta}</Small>
      <View style={styles.rowTop}>
        <Small style={[styles.muted, styles.flex]}>
          {imported && invoice.partly_recorded
            ? il.itemsOf(invoice.lines_recorded, invoice.lines_total)
            : s.itemCount(imported ? invoice.lines_recorded : invoice.lines.length)}
        </Small>
        <Body style={styles.title}>{formatPaise(parseScaled(invoice.total, 2) ?? 0)}</Body>
      </View>
    </Pressable>
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
  title: { fontFamily: fonts.bodyExtraBold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
  },
  chipActive: { backgroundColor: colours.primary },
  chipText: { color: colours.text, fontFamily: fonts.bodyExtraBold },
  chipTextActive: { color: colours.card, fontFamily: fonts.bodyExtraBold },
  row: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colours.card,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pill: {
    minHeight: 24,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
  },
  pillActive: { backgroundColor: colours.mint },
  pillActiveText: { color: colours.primary, fontFamily: fonts.bodyExtraBold },
  pillVoid: { backgroundColor: colours.background, borderWidth: 1, borderColor: colours.warning },
  pillVoidText: { color: colours.warning, fontFamily: fonts.bodyExtraBold },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
