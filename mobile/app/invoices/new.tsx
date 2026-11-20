import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ApiError } from '../../src/api/client';
import type { Invoice, InvoiceSettings } from '../../src/api/invoices';
import type { SellItem } from '../../src/api/stock';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { formatDate } from '../../src/format';
import { DateField } from '../../src/invoices/DateField';
import { InvoiceActions } from '../../src/invoices/InvoiceActions';
import { InvoiceBody } from '../../src/invoices/InvoiceBody';
import { modeLabel, PaymentPicker } from '../../src/invoices/PaymentPicker';
import {
  emptyDraft,
  invoiceDraftStorage,
  type InvoiceDraft,
  type InvoiceLineDraft,
} from '../../src/invoices/draft';
import {
  formatPaise,
  invoiceTotals,
  lineAmountPaise,
  paiseToDecimal,
  parseScaled,
} from '../../src/invoices/money';
import {
  businessToday,
  formatPhone,
  isOldDate,
  isValidIsoDate,
  normaliseIndianMobile,
  quantityMilli,
  ratePaise,
} from '../../src/invoices/validate';
import { strings } from '../../src/strings';
import { colours, fonts, radii, spacing, type } from '../../src/theme/tokens';
import {
  Banner,
  Body,
  Button,
  ConfirmDialog,
  Heading,
  Icon,
  NoAccess,
  Screen,
  Sheet,
  Small,
  TextField,
} from '../../src/ui';
import { MIN_TOUCH_TARGET } from '../../src/ui/constants';

const s = strings.invoice;

type Stage =
  | { kind: 'form' }
  | { kind: 'review' }
  | { kind: 'success'; invoice: Invoice }
  | { kind: 'already'; invoice: Invoice };

type FormErrors = {
  date?: string;
  phone?: string;
  lines?: string;
  mode?: string;
  proof?: string;
  rows: Record<number, { quantity?: string; rate?: string }>;
};

const NO_ERRORS: FormErrors = { rows: {} };

/** "220.00" (an API price) -> "220"; "220.50" stays. */
function plainRate(price: string): string {
  return price.replace(/\.00$/, '');
}

function lineAmount(line: InvoiceLineDraft): number | null {
  const qty = quantityMilli(line);
  const rate = ratePaise(line);
  return qty !== null && rate !== null ? lineAmountPaise(qty, rate) : null;
}

export default function CreateInvoice() {
  const router = useRouter();
  const { status, user, businesses, authedFetch } = useAuth();
  const params = useLocalSearchParams<{ returnTo?: string; date?: string }>();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];
  const timezone = business?.timezone ?? 'Asia/Kolkata';
  const isOwner = can(permissions, 'settings.manage');
  const backPath = params.returnTo === 'sales' ? '/sales' : '/home';
  const hubPath = `/record-sale?returnTo=${params.returnTo === 'sales' ? 'sales' : 'home'}`;
  const today = businessToday(timezone);

  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'form' });
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [sellItems, setSellItems] = useState<SellItem[] | null>(null);
  const [itemsFailed, setItemsFailed] = useState(false);
  const [settings, setSettings] = useState<InvoiceSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [cancelVisible, setCancelVisible] = useState(false);
  const savingRef = useRef(false);

  // Restore a saved draft, or start a fresh one (and so a fresh idempotency key).
  useEffect(() => {
    if (!business) return;
    let cancelled = false;
    invoiceDraftStorage.load(business.id).then((saved) => {
      if (cancelled) return;
      setDraft(saved ?? emptyDraft(today));
      if (saved?.step === 'review') setStage({ kind: 'review' });
    });
    return () => {
      cancelled = true;
    };
    // today only matters for a brand-new draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

  // Keep the draft on the device while the owner is still working on it.
  useEffect(() => {
    if (!business || !draft) return;
    if (stage.kind === 'success' || stage.kind === 'already') return;
    invoiceDraftStorage.save(business.id, {
      ...draft,
      step: stage.kind === 'review' ? 'review' : 'form',
    });
  }, [business, draft, stage.kind]);

  const loadItems = useCallback(() => {
    if (!business) return;
    setItemsFailed(false);
    authedFetch<SellItem[]>(`/businesses/${business.id}/sell-items/`)
      .then(setSellItems)
      .catch(() => setItemsFailed(true));
  }, [authedFetch, business]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!business) return;
    authedFetch<InvoiceSettings>(`/businesses/${business.id}/invoice-settings/`)
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [authedFetch, business]);

  const taxEnabled = settings?.invoice_tax_enabled ?? false;
  const taxRateText = settings?.invoice_tax_rate ?? '0';
  const taxRateHundredths = parseScaled(taxRateText, 2) ?? 0;
  const taxRateLabel = String(Number(taxRateText));

  const lines = draft?.lines ?? [];
  const amounts = lines.map((line) => lineAmount(line) ?? 0);
  const totals = useMemo(
    () => invoiceTotals(amounts, taxEnabled, taxRateHundredths),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(amounts), taxEnabled, taxRateHundredths],
  );

  if (status === 'bootstrapping' || (status === 'signedIn' && business && !draft)) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }
  if (status === 'signedOut' || !user) {
    return <Redirect href="/login" />;
  }
  if (!can(permissions, 'sales.create') || !business || !draft) {
    return (
      <Screen>
        <Header title={s.title} onBack={() => router.replace(hubPath)} />
        <NoAccess />
      </Screen>
    );
  }

  const businessId = business.id;
  const dateIsOld = isOldDate(draft.date, today);

  function update(patch: Partial<InvoiceDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setFailed(false);
  }

  function updateLine(index: number, patch: Partial<InvoiceLineDraft>) {
    setDraft((current) =>
      current
        ? { ...current, lines: current.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }
        : current,
    );
    setFailed(false);
  }

  function addItem(item: SellItem, quantity: number) {
    setDraft((current) => {
      if (!current) return current;
      const existing = current.lines.findIndex((l) => l.sellItemId === item.id);
      if (existing >= 0) {
        // An item already on the bill gets the chosen quantity added to its existing line.
        const qty = (parseScaled(current.lines[existing].quantity, 0) ?? 0) + quantity;
        return {
          ...current,
          lines: current.lines.map((l, i) =>
            i === existing ? { ...l, quantity: String(qty) } : l,
          ),
        };
      }
      return {
        ...current,
        lines: [
          ...current.lines,
          {
            sellItemId: item.id,
            name: item.name,
            quantity: String(quantity),
            rate: plainRate(item.selling_price),
          },
        ],
      };
    });
    setErrors(NO_ERRORS);
    setFailed(false);
  }

  function removeLine(index: number) {
    setDraft((current) =>
      current ? { ...current, lines: current.lines.filter((_, i) => i !== index) } : current,
    );
    setErrors(NO_ERRORS);
  }

  function step(index: number, delta: number) {
    const current = parseScaled(lines[index].quantity, 0) ?? 0;
    updateLine(index, { quantity: String(Math.max(0, current + delta)) });
  }

  /** Mirrors the server's rules; returns the errors (empty when the form can go to review). */
  function validate(): FormErrors {
    const next: FormErrors = { rows: {} };
    if (!isValidIsoDate(draft!.date)) next.date = s.errors.dateInvalid;
    else if (draft!.date > today) next.date = s.errors.futureDate;
    if (normaliseIndianMobile(draft!.phone) === null) next.phone = s.errors.phone;
    if (draft!.lines.length === 0) next.lines = s.errors.noItems;
    if (draft!.paid && draft!.mode === '') next.mode = strings.invoice.payment.modeRequired;
    else if (draft!.paid && draft!.mode !== 'cash' && draft!.proofId === null) {
      next.proof = strings.invoice.payment.proofRequired;
    }
    draft!.lines.forEach((line, index) => {
      const row: { quantity?: string; rate?: string } = {};
      if (quantityMilli(line) === null) row.quantity = s.errors.quantity;
      if (ratePaise(line) === null) row.rate = s.errors.rate;
      if (row.quantity || row.rate) next.rows[index] = row;
    });
    return next;
  }

  function hasErrors(e: FormErrors): boolean {
    return Boolean(
      e.date || e.phone || e.lines || e.mode || e.proof || Object.keys(e.rows).length > 0,
    );
  }

  function goToReview() {
    const found = validate();
    setErrors(found);
    if (hasErrors(found)) return;
    setStage({ kind: 'review' });
  }

  /** Server 400 -> the right field. Returns true when it was one we could place. */
  function applyServerErrors(err: ApiError): boolean {
    const next: FormErrors = { rows: {} };
    const fields = err.fieldErrors ?? {};
    if (fields.sale_date) next.date = s.errors.futureDate;
    if (fields.customer_phone) next.phone = s.errors.phone;
    if (fields.lines) next.lines = s.errors.noItems;
    if (fields.payment_mode) next.mode = strings.invoice.payment.modeRequired;
    if (fields.proof_id) {
      // The proof is missing, used, or expired: drop it and ask for the photo again.
      next.proof = strings.invoice.payment.proofInvalid;
      update({ proofId: null });
    }
    for (const row of err.rowErrors ?? []) {
      const index = row.row - 1;
      const current = next.rows[index] ?? {};
      if (row.field === 'quantity') current.quantity = s.errors.quantity;
      else current.rate = s.errors.rate;
      next.rows[index] = current;
    }
    if (!hasErrors(next)) return false;
    setErrors(next);
    setStage({ kind: 'form' });
    return true;
  }

  async function createInvoice() {
    if (savingRef.current || !draft) return;
    savingRef.current = true;
    setSaving(true);
    setFailed(false);
    let httpStatus = 0;
    try {
      const phone = normaliseIndianMobile(draft.phone) ?? '';
      const invoice = await authedFetch<Invoice>(`/businesses/${businessId}/invoices/`, {
        method: 'POST',
        onResponse: (code) => {
          httpStatus = code;
        },
        body: {
          sale_date: draft.date,
          customer_name: draft.name.trim(),
          ...(phone ? { customer_phone: phone } : {}),
          idempotency_key: draft.key,
          lines: draft.lines.map((line) => ({
            sell_item: line.sellItemId,
            quantity: String(parseScaled(line.quantity, 0)),
            rate: paiseToDecimal(ratePaise(line) ?? 0),
          })),
          // Sent only so the server can double-check them; it always computes its own.
          subtotal: paiseToDecimal(totals.subtotal),
          tax_amount: paiseToDecimal(totals.tax),
          total: paiseToDecimal(totals.total),
          ...(draft.paid && draft.mode
            ? {
                payment: {
                  mode: draft.mode,
                  ...(draft.mode !== 'cash' && draft.proofId !== null
                    ? { proof_id: draft.proofId }
                    : {}),
                },
              }
            : {}),
        },
      });
      await invoiceDraftStorage.clear(businessId);
      setStage(httpStatus === 200 ? { kind: 'already', invoice } : { kind: 'success', invoice });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && applyServerErrors(err)) {
        // Placed on the form; nothing else to show.
      } else {
        setFailed(true);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function finish() {
    router.replace(`${backPath}?saved=sales`);
  }

  async function cancelDraft() {
    await invoiceDraftStorage.clear(businessId);
    setCancelVisible(false);
    router.replace(hubPath);
  }

  if (stage.kind === 'success' || stage.kind === 'already') {
    return (
      <Screen>
        <ResultView invoice={stage.invoice} already={stage.kind === 'already'} onDone={finish} />
      </Screen>
    );
  }

  const customerLabel = draft.name.trim();
  const phoneNormalised = normaliseIndianMobile(draft.phone) ?? '';

  if (stage.kind === 'review') {
    return (
      <Screen>
        <View style={styles.page}>
          <Header title={s.reviewScreen.title} onBack={() => setStage({ kind: 'form' })} />
          <Small style={styles.subtitle}>{s.reviewScreen.subtitle}</Small>

          {failed ? (
            <View style={styles.failBox}>
              <Banner kind="error">{s.failed}</Banner>
              <Button
                label={s.tryAgain}
                variant="secondary"
                onPress={createInvoice}
                disabled={saving}
              />
            </View>
          ) : null}
          {dateIsOld ? <OldDateBanner onChange={() => setStage({ kind: 'form' })} /> : null}

          <View style={styles.card}>
            <SummaryRow
              label={s.dateLabel}
              value={formatDate(`${draft.date}T00:00:00Z`, 'UTC')}
              action={{ label: s.reviewScreen.change, onPress: () => setStage({ kind: 'form' }) }}
            />
            {customerLabel ? (
              <SummaryRow label={s.reviewScreen.customer} value={customerLabel} />
            ) : null}
            {phoneNormalised ? (
              <SummaryRow label={s.reviewScreen.phone} value={formatPhone(phoneNormalised)} />
            ) : null}
            <SummaryRow
              label={strings.invoice.payment.reviewRow}
              value={
                draft.paid
                  ? strings.invoice.payment.reviewPaid(
                      modeLabel(draft.mode),
                      draft.mode !== 'cash' && draft.proofId !== null,
                    )
                  : strings.invoice.payment.reviewUnpaid
              }
              action={{
                label: strings.invoice.payment.change,
                onPress: () => setStage({ kind: 'form' }),
              }}
            />
            <SummaryRow label={s.reviewScreen.number} value={s.reviewScreen.numberLater} muted />
          </View>

          <View style={styles.card}>
            <Body style={styles.sectionTitle}>{s.reviewScreen.items}</Body>
            {lines.map((line, index) => (
              <View key={line.sellItemId} style={styles.reviewLine}>
                <View style={styles.flex}>
                  <Body style={styles.lineName}>{line.name}</Body>
                  <Small style={styles.muted}>
                    {line.quantity} × {formatPaise(ratePaise(line) ?? 0)}
                  </Small>
                </View>
                <Body style={styles.lineName}>{formatPaise(amounts[index])}</Body>
              </View>
            ))}
            <TotalsBlock totals={totals} taxEnabled={taxEnabled} taxRateLabel={taxRateLabel} />
          </View>

          <Button
            label={saving ? s.reviewScreen.saving : s.reviewScreen.create}
            variant="primary"
            onPress={createInvoice}
            disabled={saving}
          />
          <Button
            label={s.reviewScreen.back}
            variant="secondary"
            onPress={() => setStage({ kind: 'form' })}
            disabled={saving}
          />
        </View>
      </Screen>
    );
  }

  // --- the form ---
  const visibleItems = sellItems ?? [];

  return (
    <Screen>
      <View style={styles.page}>
        <Header
          title={s.title}
          onBack={() => router.replace(hubPath)}
          right={
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/invoices')}
              style={styles.linkBtn}
            >
              <Small style={styles.linkText}>{s.recentInvoices}</Small>
            </Pressable>
          }
        />
        <Small style={styles.subtitle}>{s.subtitle}</Small>
        {isOwner ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/invoices/settings')}
            style={styles.linkBtn}
          >
            <Small style={styles.linkText}>{s.billSettings}</Small>
          </Pressable>
        ) : null}

        {itemsFailed ? <Banner kind="error">{s.errors.loadItems}</Banner> : null}

        <DateField
          label={s.dateLabel}
          value={draft.date}
          max={today}
          placeholder={s.datePlaceholder}
          error={errors.date}
          onChange={(value) => {
            update({ date: value });
            setErrors((e) => ({ ...e, date: undefined }));
          }}
        />
        {dateIsOld ? <OldDateBanner onChange={() => undefined} /> : null}

        <TextField
          label={s.phoneLabel}
          hint={s.phoneHint}
          value={draft.phone}
          onChangeText={(value) => {
            update({ phone: value });
            setErrors((e) => ({ ...e, phone: undefined }));
          }}
          keyboardType="phone-pad"
          maxLength={20}
          error={errors.phone}
        />
        <TextField
          label={s.nameLabel}
          value={draft.name}
          onChangeText={(value) => update({ name: value })}
          maxLength={120}
        />

        <Heading level={3}>{s.itemsTitle}</Heading>
        {lines.length === 0 ? (
          <View style={[styles.card, styles.emptyCard]}>
            <View style={styles.emptyIcon}>
              <Icon name="plus" size={24} colour={colours.primary} />
            </View>
            <Body style={styles.lineName}>{s.emptyItems}</Body>
            <Small style={errors.lines ? styles.errorText : styles.muted}>
              {errors.lines ?? s.emptyItemsHint}
            </Small>
          </View>
        ) : (
          lines.map((line, index) => (
            <LineCard
              key={line.sellItemId}
              line={line}
              amount={amounts[index]}
              errors={errors.rows[index]}
              onRate={(value) => updateLine(index, { rate: value })}
              onQuantity={(value) => updateLine(index, { quantity: value })}
              onStep={(delta) => step(index, delta)}
              onRemove={() => removeLine(index)}
            />
          ))
        )}
        <Button label={s.addItem} variant="secondary" onPress={() => setAddVisible(true)} />

        {lines.length > 0 ? (
          <View style={styles.card}>
            <TotalsBlock totals={totals} taxEnabled={taxEnabled} taxRateLabel={taxRateLabel} />
            {taxEnabled ? <Small style={styles.muted}>{s.taxNote(taxRateLabel)}</Small> : null}
          </View>
        ) : null}

        <View style={styles.card}>
          <Heading level={3}>{strings.invoice.payment.title}</Heading>
          <PaymentPicker
            allowUnpaid
            value={{ paid: draft.paid, mode: draft.mode, proofId: draft.proofId }}
            onChange={(next) => {
              update(next);
              setErrors((e) => ({ ...e, mode: undefined, proof: undefined }));
            }}
            modeError={errors.mode}
            proofError={errors.proof}
          />
        </View>

        <Button label={s.review} variant="primary" onPress={goToReview} />
        <Button label={s.cancel} variant="secondary" onPress={() => setCancelVisible(true)} />
      </View>

      <Sheet visible={addVisible} onClose={() => setAddVisible(false)} title={s.addSheet.title}>
        <AddItemList
          items={visibleItems}
          loaded={sellItems !== null}
          lines={lines}
          onAdd={addItem}
          onDone={() => setAddVisible(false)}
        />
      </Sheet>

      <ConfirmDialog
        visible={cancelVisible}
        title={s.cancelTitle}
        body={s.cancelBody}
        confirmLabel={s.cancelYes}
        cancelLabel={s.cancelNo}
        onConfirm={cancelDraft}
        onCancel={() => setCancelVisible(false)}
      />
    </Screen>
  );
}

function Header({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        style={styles.backBtn}
      >
        <Icon name="back" size={22} colour={colours.text} />
      </Pressable>
      <View style={styles.flex}>
        <Heading level={2}>{title}</Heading>
      </View>
      {right}
    </View>
  );
}

function OldDateBanner({ onChange }: { onChange: () => void }) {
  return (
    <View style={styles.failBox}>
      <Banner kind="warning">{s.oldDate}</Banner>
      <Pressable accessibilityRole="button" onPress={onChange} style={styles.linkBtn}>
        <Small style={styles.linkText}>{s.changeDate}</Small>
      </Pressable>
    </View>
  );
}

function SummaryRow({
  label,
  value,
  muted,
  action,
}: {
  label: string;
  value: string;
  muted?: boolean;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.summaryRow}>
      <Small style={styles.muted}>{label}</Small>
      <View style={styles.summaryValue}>
        <Body style={muted ? styles.muted : styles.lineName}>{value}</Body>
        {action ? (
          <Pressable accessibilityRole="button" onPress={action.onPress} style={styles.linkBtn}>
            <Small style={styles.linkText}>{action.label}</Small>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function TotalsBlock({
  totals,
  taxEnabled,
  taxRateLabel,
}: {
  totals: { subtotal: number; tax: number; total: number };
  taxEnabled: boolean;
  taxRateLabel: string;
}) {
  return (
    <View style={styles.totals}>
      {taxEnabled ? (
        <>
          <View style={styles.totalRow}>
            <Body style={styles.muted}>{s.subtotal}</Body>
            <Body>{formatPaise(totals.subtotal)}</Body>
          </View>
          <View style={styles.totalRow}>
            <Body style={styles.muted}>{s.taxRow(taxRateLabel)}</Body>
            <Body>{formatPaise(totals.tax)}</Body>
          </View>
        </>
      ) : null}
      <View style={styles.totalRow}>
        <Body style={styles.lineName}>{s.total}</Body>
        <Body style={styles.totalValue}>{formatPaise(totals.total)}</Body>
      </View>
    </View>
  );
}

function LineCard({
  line,
  amount,
  errors,
  onRate,
  onQuantity,
  onStep,
  onRemove,
}: {
  line: InvoiceLineDraft;
  amount: number;
  errors?: { quantity?: string; rate?: string };
  onRate: (value: string) => void;
  onQuantity: (value: string) => void;
  onStep: (delta: number) => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.lineHead}>
        <View style={styles.flex}>
          <Body style={styles.lineName}>{line.name}</Body>
          {errors?.quantity ? (
            <Small style={styles.errorText}>{errors.quantity}</Small>
          ) : (
            <Small style={styles.muted}>{s.itemYouSell}</Small>
          )}
        </View>
      </View>
      <View style={styles.stepperRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.decrease}
          onPress={() => onStep(-1)}
          style={styles.stepBtn}
        >
          <Icon name="minus" size={20} colour={colours.primary} />
        </Pressable>
        <View style={styles.qtyWrap}>
          <TextField
            label={s.quantityLabel}
            value={line.quantity}
            onChangeText={(text) => onQuantity(text.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            maxLength={6}
            accessibilityLabel={`${s.quantityLabel} ${line.name}`}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.increase}
          onPress={() => onStep(1)}
          style={styles.stepBtn}
        >
          <Icon name="plus" size={20} colour={colours.primary} />
        </Pressable>
      </View>
      <TextField
        label={s.rateLabel}
        value={line.rate}
        onChangeText={(text) => onRate(text.replace(/[^0-9.]/g, ''))}
        keyboardType="decimal-pad"
        maxLength={11}
        error={errors?.rate}
        accessibilityLabel={`${s.rateLabel} ${line.name}`}
      />
      <View style={styles.totalRow}>
        <Small style={styles.muted}>{s.lineAmount}</Small>
        <Body style={styles.lineName}>{formatPaise(amount)}</Body>
      </View>
      <Pressable accessibilityRole="button" onPress={onRemove} style={styles.removeBtn}>
        <Icon name="delete" size={18} colour={colours.danger} />
        <Small style={styles.removeText}>{s.removeItem}</Small>
      </Pressable>
    </View>
  );
}

function AddItemList({
  items,
  loaded,
  lines,
  onAdd,
  onDone,
}: {
  items: SellItem[];
  loaded: boolean;
  lines: InvoiceLineDraft[];
  onAdd: (item: SellItem, quantity: number) => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState('');
  const shown = items.filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase()));
  const onBill = new Map(lines.map((l) => [l.sellItemId, parseScaled(l.quantity, 0) ?? 0]));
  const doneLabel = lines.length > 0 ? s.addSheet.doneCount(lines.length) : s.addSheet.done;

  if (loaded && items.length === 0) {
    return (
      <View style={styles.sheetStack}>
        <Body>{s.addSheet.noItems}</Body>
        <Button label={s.addSheet.done} variant="primary" onPress={onDone} />
      </View>
    );
  }
  return (
    <View style={styles.sheetStack}>
      <Body style={styles.muted}>{s.addSheet.lead}</Body>
      <TextField label={s.addSheet.search} value={query} onChangeText={setQuery} />
      {shown.length === 0 && loaded ? (
        <Small style={styles.muted}>{s.addSheet.noMatch}</Small>
      ) : null}
      {shown.map((item) => (
        <AddItemRow key={item.id} item={item} onBill={onBill.get(item.id)} onAdd={onAdd} />
      ))}
      <Button label={doneLabel} variant="primary" onPress={onDone} />
    </View>
  );
}

/** One item in the Add item sheet: name and price on top, then a fixed-height line with the
 * quantity stepper (default 1, whole numbers like the bill itself) and an Add button, so the layout
 * never shifts when "On bill: N" appears. */
function AddItemRow({
  item,
  onBill,
  onAdd,
}: {
  item: SellItem;
  onBill: number | undefined;
  onAdd: (item: SellItem, quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState('1');
  const parsed = parseScaled(quantity, 0);
  const valid = parsed !== null && parsed >= 1;

  function change(delta: number) {
    setQuantity(String(Math.max(1, (parsed ?? 1) + delta)));
  }

  return (
    <View style={styles.itemRow}>
      <View style={styles.itemTop}>
        <View style={styles.flex}>
          <Body style={styles.lineName}>{item.name}</Body>
          <Small style={styles.muted}>
            {onBill ? s.addSheet.onBill(onBill) : s.addSheet.notOnBill}
          </Small>
        </View>
        <Body style={styles.lineName}>{formatPaise(parseScaled(item.selling_price, 2) ?? 0)}</Body>
      </View>
      <View style={styles.itemControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.decrease}
          onPress={() => change(-1)}
          style={styles.miniStep}
        >
          <Icon name="minus" size={18} colour={colours.primary} />
        </Pressable>
        <TextInput
          accessibilityLabel={s.addSheet.quantity(item.name)}
          value={quantity}
          onChangeText={(text) => setQuantity(text.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          maxLength={6}
          style={styles.miniQty}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.increase}
          onPress={() => change(1)}
          style={styles.miniStep}
        >
          <Icon name="plus" size={18} colour={colours.primary} />
        </Pressable>
        <View style={styles.flex} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${s.addSheet.add} ${item.name}`}
          accessibilityState={{ disabled: !valid }}
          disabled={!valid}
          onPress={() => {
            onAdd(item, parsed ?? 1);
            setQuantity('1');
          }}
          style={[styles.addBtn, !valid ? styles.addBtnDisabled : null]}
        >
          <Body style={styles.addBtnText}>{s.addSheet.add}</Body>
        </Pressable>
      </View>
    </View>
  );
}

function ResultView({
  invoice,
  already,
  onDone,
}: {
  invoice: Invoice;
  already: boolean;
  onDone: () => void;
}) {
  return (
    <View style={styles.page}>
      {already ? (
        <Banner kind="info">{s.already.banner}</Banner>
      ) : (
        <>
          <View style={styles.successIcon}>
            <Icon name="success" size={32} colour={colours.card} />
          </View>
          <Heading level={2}>{s.success.title}</Heading>
          <Body style={styles.muted}>{s.success.body}</Body>
        </>
      )}
      <InvoiceBody invoice={invoice} />
      <InvoiceActions invoice={invoice} />
      <Button
        label={already ? s.already.done : s.success.done}
        variant="primary"
        onPress={onDone}
      />
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
  page: { gap: spacing.md },
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
  subtitle: { color: colours.muted },
  muted: { color: colours.muted },
  linkBtn: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  linkText: { color: colours.primary, fontFamily: fonts.bodyExtraBold },
  card: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colours.card,
  },
  emptyCard: { alignItems: 'center', paddingVertical: spacing.xl },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { fontFamily: fonts.bodyExtraBold },
  lineHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lineName: { fontFamily: fonts.bodyExtraBold },
  errorText: { color: colours.danger, fontFamily: fonts.bodyExtraBold },
  stepperRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  qtyWrap: { flex: 1, minWidth: 0 },
  stepBtn: {
    width: 48,
    height: 48,
    marginBottom: 2,
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totals: { gap: spacing.xs },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  totalValue: { fontFamily: fonts.headingBold, fontSize: type.lg },
  removeBtn: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
  },
  removeText: { color: colours.danger, fontFamily: fonts.bodyExtraBold },
  failBox: { gap: spacing.xs },
  summaryRow: { gap: 2 },
  summaryValue: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  reviewLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sheetMessage: { marginBottom: spacing.lg },
  sheetStack: { gap: spacing.sm },
  itemRow: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    backgroundColor: colours.card,
  },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  itemControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  miniStep: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniQty: {
    width: 64,
    height: 44,
    textAlign: 'center',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    color: colours.text,
    fontFamily: fonts.bodyExtraBold,
    fontSize: type.md,
    backgroundColor: colours.card,
  },
  addBtn: {
    minWidth: 88,
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colours.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { color: colours.card, fontFamily: fonts.bodyExtraBold },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colours.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
