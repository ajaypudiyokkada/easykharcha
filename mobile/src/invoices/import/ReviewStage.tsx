import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ApiError } from '../../api/client';
import type {
  ImportCheck,
  ImportLine,
  InvoiceImport,
  LineDecision,
} from '../../api/invoiceImports';
import type { Invoice } from '../../api/invoices';
import type { SellItem } from '../../api/stock';
import { useAuth } from '../../auth/AuthContext';
import { strings } from '../../strings';
import { colours, fonts, radii, spacing, type } from '../../theme/tokens';
import { Banner, Body, Button, Checkbox, Heading, Small } from '../../ui';
import { billDate } from '../billText';
import { DateField } from '../DateField';
import type { ImportProgress } from '../importStore';
import { formatPaise, parseScaled } from '../money';
import { PhotoModal, usePhotoUrl } from '../usePhotoUrl';
import { isOldDate, isValidIsoDate } from '../validate';
import { PickItemSheet } from './PickItemSheet';
import { modeLabel, PaymentPicker } from '../PaymentPicker';

const s = strings.importInvoice.review;

const UNDECIDED: LineDecision = { decision: null, sellItemId: null, remember: false };

/** "380" -> "₹380", "-62" -> "−₹62", "+0.10" -> "+₹0.10"; anything odd is shown as printed. */
function money(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const negative = value.startsWith('-');
  const unsigned = value.replace(/^[-+]/, '');
  const paise = parseScaled(unsigned, 2);
  if (paise === null) return value;
  return `${negative ? '−' : value.startsWith('+') ? '+' : ''}${formatPaise(paise)}`;
}

function shortDate(iso: string): string {
  return isValidIsoDate(iso) ? billDate(iso).replace(/ \d{4}$/, '') : '';
}

type Props = {
  imp: InvoiceImport;
  businessId: number;
  today: string;
  progress: ImportProgress;
  onProgress: (next: ImportProgress) => void;
  onConfirmed: (invoice: Invoice) => void;
  onManual: () => void;
  onBack: () => void;
  /** Opens an earlier invoice's detail (from a duplicate or same-photo banner). */
  onViewEarlier: (invoiceId: number) => void;
};

export function ReviewStage({
  imp,
  businessId,
  today,
  progress,
  onProgress,
  onConfirmed,
  onManual,
  onBack,
  onViewEarlier,
}: Props) {
  const { authedFetch } = useAuth();
  const draft = imp.draft!;
  const lines = draft.lines;

  const [items, setItems] = useState<SellItem[] | null>(null);
  const [pickLineId, setPickLineId] = useState<string | null>(null);
  const [viewer, setViewer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [alreadyAdded, setAlreadyAdded] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [forceAddAnyway, setForceAddAnyway] = useState(false);
  const [paymentErrors, setPaymentErrors] = useState<{ mode?: string; proof?: string }>({});
  const savingRef = useRef(false);

  const photoPath =
    imp.file_type === 'image' && imp.photo_available
      ? `/businesses/${businessId}/invoice-imports/${imp.id}/photo/`
      : null;
  const photo = usePhotoUrl(photoPath);

  useEffect(() => {
    authedFetch<SellItem[]>(`/businesses/${businessId}/sell-items/`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [authedFetch, businessId]);

  const saleDate = progress.saleDate ?? draft.bill_date ?? '';
  const billNumber = progress.billNumber ?? draft.bill_number ?? '';
  const dateValid = isValidIsoDate(saleDate);
  const dateFuture = dateValid && saleDate > today;
  const dateOld = dateValid && !dateFuture && isOldDate(saleDate, today);

  function decisionOf(line: ImportLine): LineDecision {
    const saved = progress.decisions[line.line_id];
    if (saved) return saved;
    if (line.match.state === 'matched' && line.match.sell_item_id !== null) {
      return { decision: 'item', sellItemId: line.match.sell_item_id, remember: false };
    }
    return UNDECIDED;
  }

  function setDecision(line: ImportLine, next: LineDecision) {
    setLineErrors((e) => ({ ...e, [line.line_id]: '' }));
    onProgress({ ...progress, decisions: { ...progress.decisions, [line.line_id]: next } });
  }

  const canBeItem = (line: ImportLine) =>
    parseScaled(line.qty ?? '', 3) !== null && parseScaled(line.amount ?? '', 2) !== null;

  const nameOf = (id: number | null): string => {
    if (id === null) return '';
    return items?.find((i) => i.id === id)?.name ?? '';
  };

  const decided = lines.map((l) => decisionOf(l));
  const itemCount = decided.filter((d) => d.decision === 'item').length;
  const skipCount = decided.filter((d) => d.decision === 'skip').length;
  const undecidedCount = decided.filter((d) => d.decision === null).length;

  const checks = draft.checks;
  const find = (code: string): ImportCheck[] => checks.filter((c) => c.code === code);
  const duplicateChecks = checks.filter(
    (c) =>
      c.code === 'DUPLICATE_BILL' || c.code === 'POSSIBLE_DUPLICATE' || c.code === 'SAME_PHOTO',
  );
  const needsAddAnyway = duplicateChecks.length > 0 || forceAddAnyway;
  const lowFields = useMemo(() => {
    const out = new Set<string>();
    for (const c of find('LOW_CONFIDENCE')) {
      for (const f of (c.data.fields as { field: string; line_id?: string }[]) ?? []) {
        out.add(f.line_id ? `line:${f.line_id}` : f.field);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checks]);

  const zeroMatch = find('ZERO_MATCH').length > 0 && decided.every((d) => d.decision === null);

  const buttonLabel =
    skipCount > 0
      ? s.addPartial(itemCount, itemCount + skipCount)
      : s.addItems(itemCount, dateValid ? shortDate(saleDate) : '').replace('  ', ' ');
  const payment = progress.payment;
  // Paid needs a mode, and a proof photo for every mode except cash. Unpaid needs nothing.
  const paymentIncomplete =
    payment.paid && (payment.mode === '' || (payment.mode !== 'cash' && payment.proofId === null));
  const ready =
    undecidedCount === 0 &&
    dateValid &&
    !dateFuture &&
    itemCount > 0 &&
    (skipCount === 0 || progress.acceptPartial) &&
    (!needsAddAnyway || progress.addAnyway) &&
    !paymentIncomplete &&
    !saving;

  async function confirm() {
    if (savingRef.current || !ready) return;
    savingRef.current = true;
    setSaving(true);
    setFailed(false);
    setDateError(null);
    setLineErrors({});
    setPaymentErrors({});
    let status = 0;
    try {
      const invoice = await authedFetch<Invoice>(
        `/businesses/${businessId}/invoice-imports/${imp.id}/confirm/`,
        {
          method: 'POST',
          onResponse: (code) => {
            status = code;
          },
          body: {
            idempotency_key: progress.key,
            sale_date: saleDate,
            ...(billNumber.trim() ? { bill_number: billNumber.trim() } : {}),
            lines: lines.map((line, index) => ({
              line_id: line.line_id,
              decision: decided[index].decision,
              ...(decided[index].decision === 'item'
                ? { sell_item_id: decided[index].sellItemId }
                : {}),
              remember: decided[index].remember,
            })),
            accept_partial: skipCount > 0 && progress.acceptPartial,
            add_anyway: needsAddAnyway && progress.addAnyway,
            ...(payment.paid && payment.mode
              ? {
                  payment: {
                    mode: payment.mode,
                    ...(payment.mode !== 'cash' && payment.proofId !== null
                      ? { proof_id: payment.proofId }
                      : {}),
                  },
                }
              : {}),
          },
        },
      );
      void status;
      onConfirmed(invoice);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.code === 'IMPORT_ALREADY_CONFIRMED'
      ) {
        setAlreadyAdded(true);
      } else if (err instanceof ApiError && err.status === 400) {
        const fields = err.fieldErrors ?? {};
        let placed = false;
        if (fields.sale_date) {
          setDateError(s.dateFuture);
          placed = true;
        }
        if (fields.payment_mode) {
          setPaymentErrors({ mode: strings.invoice.payment.modeRequired });
          placed = true;
        }
        if (fields.proof_id) {
          // The proof is missing, used or expired: drop it and ask for the photo again.
          setPaymentErrors({ proof: strings.invoice.payment.proofInvalid });
          onProgress({ ...progress, payment: { ...payment, proofId: null } });
          placed = true;
        }
        if (fields.add_anyway) {
          setForceAddAnyway(true);
          placed = true;
        }
        if (fields.accept_partial) placed = true;
        const rows: Record<string, string> = {};
        for (const row of err.rowErrors ?? []) {
          if (row.line_id) {
            rows[row.line_id] = row.message || s.lineProblem;
            placed = true;
          }
        }
        setLineErrors(rows);
        if (!placed) setFailed(true);
      } else {
        setFailed(true);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const pickLine = lines.find((l) => l.line_id === pickLineId) ?? null;

  return (
    <View style={styles.page}>
      <Heading level={2}>{s.title}</Heading>
      <Small style={styles.muted}>{s.subtitle}</Small>

      {/* --- date --- */}
      <View style={styles.card}>
        <DateField
          label={s.saleDate}
          value={saleDate}
          max={today}
          placeholder={s.datePlaceholder}
          error={dateError ?? (!dateValid ? s.dateMissing : dateFuture ? s.dateFuture : undefined)}
          onChange={(value) => {
            setDateError(null);
            onProgress({ ...progress, saleDate: value });
          }}
        />
        {lowFields.has('bill_date') ? <Pill label={s.pleaseCheck} /> : null}
        {dateOld ? <Banner kind="warning">{s.dateOld}</Banner> : null}
      </View>

      {/* --- photo --- */}
      {photoPath ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => photo.url && setViewer(true)}
          style={[styles.card, styles.photoCard]}
        >
          {photo.url
            ? React.createElement('img', {
                src: photo.url,
                alt: s.photoTitle,
                style: {
                  width: 64,
                  height: 64,
                  objectFit: 'cover',
                  borderRadius: radii.md,
                  border: `2px solid ${colours.mint}`,
                },
              })
            : null}
          <View style={styles.flex}>
            <Body style={styles.bold}>{s.photoTitle}</Body>
            <Small style={styles.muted}>
              {photo.state === 'removed' ? s.photoRemoved : s.photoTap}
            </Small>
            <Small style={styles.muted}>{s.photoKept}</Small>
          </View>
        </Pressable>
      ) : null}
      <PhotoModal url={photo.url} visible={viewer} onClose={() => setViewer(false)} />

      {/* --- bill number --- */}
      <View style={styles.card}>
        <View style={styles.row}>
          <Body style={styles.bold}>{billNumber ? s.billNumber : s.billNumberOptional}</Body>
          {lowFields.has('bill_number') ? <Pill label={s.pleaseCheck} /> : null}
        </View>
        <TextInput
          accessibilityLabel={s.billNumber}
          value={billNumber}
          onChangeText={(text) => onProgress({ ...progress, billNumber: text })}
          maxLength={40}
          style={styles.input}
        />
        {draft.bill_number ? <Small style={styles.muted}>{s.fromBill}</Small> : null}
      </View>

      {/* --- warnings --- */}
      {find('TOTAL_MISMATCH').map((c, i) => (
        <Banner key={`tm${i}`} kind="warning">
          {c.data.kind === 'items'
            ? s.totalItems(money(String(c.data.sum_of_lines)), money(String(c.data.printed)))
            : s.totalGrand(money(String(c.data.computed)), money(String(c.data.printed)))}
        </Banner>
      ))}
      {find('REPRINT_COPY').length > 0 ? <Banner kind="warning">{s.reprint}</Banner> : null}
      {duplicateChecks.map((c, i) => (
        <View key={`d${i}`} style={styles.gap}>
          <Banner kind="warning">
            {c.code === 'SAME_PHOTO'
              ? s.samePhoto
              : s.duplicate(String(c.data.number), shortDate(String(c.data.date)))}
          </Banner>
          {typeof c.data.invoice_id === 'number' ? (
            <LinkButton
              label={s.viewEarlier}
              onPress={() => onViewEarlier(c.data.invoice_id as number)}
            />
          ) : null}
        </View>
      ))}
      {forceAddAnyway && duplicateChecks.length === 0 ? (
        <Banner kind="warning">{strings.importInvoice.review.samePhoto}</Banner>
      ) : null}
      {needsAddAnyway ? (
        <Checkbox
          title={s.addAnyway}
          checked={progress.addAnyway}
          onChange={(value) => onProgress({ ...progress, addAnyway: value })}
        />
      ) : null}

      {zeroMatch ? (
        <View style={styles.gap}>
          <Banner kind="warning">{s.zeroMatch}</Banner>
          <Button
            label={s.pickOneByOne}
            variant="primary"
            onPress={() => setPickLineId(lines[0]?.line_id ?? null)}
          />
          <Button
            label={strings.importInvoice.enterManually}
            variant="secondary"
            onPress={onManual}
          />
        </View>
      ) : null}

      {/* --- lines --- */}
      <Heading level={3}>{s.itemsTitle}</Heading>
      {lines.map((line, index) => (
        <LineCard
          key={line.line_id}
          line={line}
          decision={decided[index]}
          itemName={nameOf(decided[index].sellItemId) || line.match.sell_item_name || ''}
          canBeItem={canBeItem(line)}
          lowConfidence={lowFields.has(`line:${line.line_id}`)}
          mismatch={checks.find(
            (c) => c.code === 'LINE_AMOUNT_MISMATCH' && c.line_id === line.line_id,
          )}
          error={lineErrors[line.line_id]}
          onConfirmSuggestion={() => {
            if (line.match.state === 'check_match' && line.match.suggestion) {
              setDecision(line, {
                decision: 'item',
                sellItemId: line.match.suggestion.sell_item_id,
                remember: true,
              });
            } else if (line.match.state === 'not_an_item_suggested') {
              setDecision(line, {
                decision: 'not_item',
                sellItemId: null,
                remember: line.match.source !== 'remembered',
              });
            }
          }}
          onPick={() => setPickLineId(line.line_id)}
          onUndo={() => setDecision(line, UNDECIDED)}
        />
      ))}

      {/* --- totals as printed --- */}
      <View style={styles.card}>
        {draft.items_total !== null ? (
          <TotalRow label={s.itemsTotal} value={money(draft.items_total)} />
        ) : null}
        {draft.discounts.map((c, i) => (
          <TotalRow
            key={`disc${i}`}
            label={c.label || s.discount}
            value={money(c.amount === null ? null : `-${c.amount.replace(/^-/, '')}`)}
          />
        ))}
        {draft.taxes.map((c, i) => (
          <TotalRow key={`tax${i}`} label={c.label} value={money(c.amount)} />
        ))}
        {draft.round_off !== null ? (
          <TotalRow
            label={s.roundOff}
            value={money(draft.round_off.startsWith('-') ? draft.round_off : `+${draft.round_off}`)}
          />
        ) : null}
        <TotalRow
          label={s.billTotal}
          value={money(draft.grand_total)}
          strong
          pill={lowFields.has('grand_total')}
        />
      </View>

      {/* --- payment (optional) --- */}
      <View style={styles.card}>
        <Heading level={3}>{s.paymentOptional}</Heading>
        <Small style={styles.muted}>{s.paymentHint}</Small>
        {draft.payment_mode ? (
          <Small style={styles.muted}>
            {s.billSays(draft.payment_mode === 'other' ? 'Other' : modeLabel(draft.payment_mode))}
          </Small>
        ) : null}
        <PaymentPicker
          allowUnpaid
          value={payment}
          onChange={(next) => {
            setPaymentErrors({});
            onProgress({ ...progress, payment: next });
          }}
          modeError={paymentErrors.mode}
          proofError={
            paymentErrors.proof ??
            (paymentIncomplete && payment.mode !== ''
              ? strings.invoice.payment.proofRequired
              : undefined)
          }
        />
      </View>

      {/* --- confirm --- */}
      {skipCount > 0 ? (
        <Checkbox
          title={s.partialTick(skipCount)}
          checked={progress.acceptPartial}
          onChange={(value) => onProgress({ ...progress, acceptPartial: value })}
        />
      ) : null}
      {undecidedCount > 0 ? (
        <Small style={styles.muted}>{s.needChoices(undecidedCount)}</Small>
      ) : null}
      {failed ? <Banner kind="error">{s.failed}</Banner> : null}
      {alreadyAdded ? <Banner kind="info">{s.alreadyAdded}</Banner> : null}
      <Small style={styles.muted}>{s.nothingYet}</Small>
      {alreadyAdded ? (
        <Button label={strings.importInvoice.success.done} variant="primary" onPress={onBack} />
      ) : (
        <Button
          label={saving ? s.saving : failed ? s.tryAgain : buttonLabel}
          variant="primary"
          onPress={confirm}
          disabled={!ready}
        />
      )}
      <Button label={s.back} variant="secondary" onPress={onBack} disabled={saving} />

      <PickItemSheet
        visible={pickLine !== null}
        onClose={() => setPickLineId(null)}
        lineName={pickLine?.name_as_printed ?? ''}
        items={items}
        canBeItem={pickLine ? canBeItem(pickLine) : true}
        onPickItem={(item, remember) => {
          if (pickLine) setDecision(pickLine, { decision: 'item', sellItemId: item.id, remember });
          setPickLineId(null);
        }}
        onNotItem={(remember) => {
          if (pickLine) setDecision(pickLine, { decision: 'not_item', sellItemId: null, remember });
          setPickLineId(null);
        }}
        onSkip={() => {
          if (pickLine)
            setDecision(pickLine, { decision: 'skip', sellItemId: null, remember: false });
          setPickLineId(null);
        }}
      />
    </View>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <View style={styles.pill}>
      <Small style={styles.pillText}>{label}</Small>
    </View>
  );
}

function TotalRow({
  label,
  value,
  strong,
  pill,
}: {
  label: string;
  value: string;
  strong?: boolean;
  pill?: boolean;
}) {
  return (
    <View style={styles.totalRow}>
      <View style={styles.flex}>
        <Body style={strong ? styles.bold : styles.muted}>{label}</Body>
        <Small style={styles.muted}>{strings.importInvoice.review.fromBill}</Small>
      </View>
      {pill ? <Pill label={s.pleaseCheck} /> : null}
      <Body style={strong ? styles.total : undefined}>{value}</Body>
    </View>
  );
}

function LineCard({
  line,
  decision,
  itemName,
  canBeItem,
  lowConfidence,
  mismatch,
  error,
  onConfirmSuggestion,
  onPick,
  onUndo,
}: {
  line: ImportLine;
  decision: LineDecision;
  itemName: string;
  canBeItem: boolean;
  lowConfidence: boolean;
  mismatch?: ImportCheck;
  error?: string;
  onConfirmSuggestion: () => void;
  onPick: () => void;
  onUndo: () => void;
}) {
  const m = line.match;
  const qty = line.qty === null ? '—' : String(Number(line.qty));
  const rate = line.unit_rate === null ? '' : ` × ${money(line.unit_rate)}`;
  return (
    <View style={[styles.card, mismatch || error ? styles.cardWarn : null]}>
      <View style={styles.row}>
        <Body style={[styles.bold, styles.flex]}>{line.name_as_printed}</Body>
        {lowConfidence ? <Pill label={s.pleaseCheck} /> : null}
      </View>
      <View style={styles.row}>
        <Small style={[styles.muted, styles.flex]}>
          {qty}
          {rate} = {money(line.amount)} · {s.fromBill}
        </Small>
        <Body style={styles.bold}>{money(line.amount)}</Body>
      </View>
      {mismatch ? (
        <View style={styles.gap}>
          <Small style={styles.warn}>
            {s.lineMismatch(
              String(Number(mismatch.data.qty)),
              money(String(mismatch.data.unit_rate)),
              money(String(mismatch.data.expected)),
              money(String(mismatch.data.amount)),
            )}
          </Small>
          <Pill label={s.checkLine} />
        </View>
      ) : null}

      {decision.decision === 'item' ? (
        <View style={styles.row}>
          <Small style={[styles.ok, styles.flex]}>
            {m.state === 'matched' && !decisionChanged(m, decision)
              ? s.matchedTo(itemName)
              : s.itemChosen(itemName)}
          </Small>
          <LinkButton label={s.changeItem} onPress={onPick} />
        </View>
      ) : decision.decision === 'not_item' ? (
        <View style={styles.row}>
          <Small style={[styles.muted, styles.flex]}>
            {s.notAnItem} · {s.notAnItemHint}
          </Small>
          <LinkButton label={s.undo} onPress={onUndo} />
        </View>
      ) : decision.decision === 'skip' ? (
        <View style={styles.row}>
          <Small style={[styles.muted, styles.flex]}>{s.skipped}</Small>
          <LinkButton label={s.undo} onPress={onUndo} />
        </View>
      ) : m.state === 'check_match' && m.suggestion && canBeItem ? (
        <View style={styles.gap}>
          <Small style={styles.warn}>
            {s.checkMatch} · {s.suggested(m.suggestion.name)}
          </Small>
          <View style={styles.row}>
            <LinkButton label={s.confirm} onPress={onConfirmSuggestion} />
            <LinkButton label={s.changeItem} onPress={onPick} />
          </View>
        </View>
      ) : m.state === 'not_an_item_suggested' ? (
        <View style={styles.gap}>
          <Small style={styles.warn}>{s.chargeHint}</Small>
          <View style={styles.row}>
            <LinkButton label={s.confirm} onPress={onConfirmSuggestion} />
            {canBeItem ? <LinkButton label={s.itIsItem} onPress={onPick} /> : null}
          </View>
        </View>
      ) : (
        <View style={styles.gap}>
          <Small style={styles.warn}>{s.notMatched}</Small>
          {!canBeItem ? <Small style={styles.muted}>{s.cannotBeItem}</Small> : null}
          <View style={styles.row}>
            <LinkButton label={canBeItem ? s.pickItem : s.notAnItem} onPress={onPick} />
          </View>
        </View>
      )}
      {error ? <Small style={styles.errorText}>{error}</Small> : null}
    </View>
  );
}

/** A line that came in matched but whose item the owner then changed is "Item: X", not "Matched". */
function decisionChanged(match: ImportLine['match'], decision: LineDecision): boolean {
  return decision.sellItemId !== match.sell_item_id;
}

function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link}>
      <Small style={styles.linkText}>{label}</Small>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  gap: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  muted: { color: colours.muted },
  bold: { fontFamily: fonts.bodyExtraBold },
  ok: { color: colours.success, fontFamily: fonts.bodyExtraBold },
  warn: { color: colours.warning, fontFamily: fonts.bodyExtraBold },
  errorText: { color: colours.danger, fontFamily: fonts.bodyExtraBold },
  card: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colours.card,
  },
  cardWarn: { borderColor: colours.warning },
  photoCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  input: {
    minHeight: 52,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    color: colours.text,
    fontFamily: fonts.body,
    fontSize: type.md,
    backgroundColor: colours.card,
  },
  pill: {
    minHeight: 24,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colours.warning,
    backgroundColor: colours.background,
    alignSelf: 'flex-start',
  },
  pillText: { color: colours.warning, fontFamily: fonts.bodyExtraBold },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  total: { fontFamily: fonts.headingBold, fontSize: type.lg },
  link: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  linkText: { color: colours.primary, fontFamily: fonts.bodyExtraBold },
});
