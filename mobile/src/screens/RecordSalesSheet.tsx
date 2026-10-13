import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ApiError } from '../api/client';
import type { Sale } from '../api/sales';
import type { SellItem } from '../api/stock';
import { useAuth } from '../auth/AuthContext';
import { formatRupees } from '../format';
import { strings } from '../strings';
import { colours, fonts, radii, spacing } from '../theme/tokens';
import { Banner, Body, Button, Icon, Sheet, Small, TextField } from '../ui';

const s = strings.salesForm;

type LineDraft = {
  sellItemId: number | null;
  quantity: string;
  amount: string;
};

/** "Today" in the business's own timezone, not the device's — a sale dated by the device's local
 * calendar day could land on the wrong side of midnight from the business's point of view, and then
 * silently fall outside every count's sales-vs-gap window it should have counted toward. */
function businessToday(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

function emptyLine(sellItemId: number | null = null): LineDraft {
  return { sellItemId, quantity: '', amount: '' };
}

function defaultAmount(line: LineDraft, sellItems: SellItem[]): string {
  const item = sellItems.find((i) => i.id === line.sellItemId);
  const qty = Number(line.quantity);
  if (!item || !Number.isFinite(qty)) return '';
  return (qty * Number(item.selling_price)).toFixed(2);
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: (sales: Sale[]) => void;
  /** Defaults to today — the Sales screen's date switcher passes the day currently being viewed. */
  initialDate?: string;
};

/** Date, one or more lines (item sold + how many + total, defaulting to quantity x selling price but
 * editable), "Add another item", "Save sales". Reuses the Step 9 multi-line pattern. */
export function RecordSalesSheet({ visible, onClose, onSaved, initialDate }: Props) {
  const { authedFetch, businesses } = useAuth();
  const business = businesses[0];
  const timezone = business?.timezone ?? 'Asia/Kolkata';

  const [sellItems, setSellItems] = useState<SellItem[]>([]);
  const [date, setDate] = useState(() => initialDate ?? businessToday(timezone));
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !business) return;
    authedFetch<SellItem[]>(`/businesses/${business.id}/sell-items/`)
      .then(setSellItems)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, business?.id]);

  useEffect(() => {
    if (!visible) return;
    setDate(initialDate ?? businessToday(timezone));
    setLines([emptyLine()]);
    setLineErrors({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialDate, timezone]);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((current) =>
      current.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, ...patch };
        // Re-price only when the item or quantity changed, not when the amount itself was hand-
        // edited — an explicit override must stick until the item/quantity changes again.
        if ('sellItemId' in patch || 'quantity' in patch) {
          next.amount = defaultAmount(next, sellItems);
        }
        return next;
      }),
    );
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, i) => i !== index));
  }

  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);

  async function handleSave() {
    setFormError(null);
    const errors: Record<number, string> = {};
    lines.forEach((line, index) => {
      if (!line.sellItemId) errors[index] = s.errors.itemRequired;
      else if (!line.quantity.trim()) errors[index] = s.errors.quantityRequired;
    });
    setLineErrors(errors);
    if (Object.keys(errors).length > 0 || !business) return;

    setSaving(true);
    try {
      const payload = {
        business_date: date,
        lines: lines.map((line) => ({
          sell_item: line.sellItemId,
          quantity: line.quantity,
          amount: line.amount || undefined,
        })),
      };
      const sales = await authedFetch<Sale[]>(`/businesses/${business.id}/sales/`, {
        method: 'POST',
        body: payload,
      });
      onSaved(sales);
    } catch (err) {
      if (err instanceof ApiError && err.rowErrors) {
        const nextErrors: Record<number, string> = {};
        for (const rowErr of err.rowErrors) nextErrors[rowErr.row - 1] = rowErr.message;
        setLineErrors(nextErrors);
        setFormError(s.errors.generic);
      } else if (err instanceof ApiError && err.code === 'FUTURE_SALE_DATE') {
        setFormError(s.errors.futureDate);
      } else if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
        setFormError(s.errors.network);
      } else if (err instanceof ApiError) {
        setFormError(err.message || s.errors.generic);
      } else {
        setFormError(s.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={s.sheetTitle}>
      <Body style={styles.subtitle}>{s.sheetSubtitle}</Body>
      {formError ? <Banner kind="error">{formError}</Banner> : null}

      <TextField label={s.dateLabel} value={date} onChangeText={setDate} />

      {lines.map((line, index) => (
        <View key={index} style={styles.lineCard}>
          <View style={styles.lineHead}>
            <Small style={styles.lineLabel}>{s.lineItemLabel}</Small>
            {lines.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.removeLine}
                onPress={() => removeLine(index)}
                style={styles.removeBtn}
              >
                <Icon name="delete" size={18} colour={colours.danger} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.itemChips}>
            {sellItems.map((item) => {
              const selected = line.sellItemId === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => updateLine(index, { sellItemId: item.id })}
                  style={[styles.itemChip, selected ? styles.itemChipSelected : null]}
                >
                  <Small style={selected ? styles.itemChipTextSelected : styles.itemChipText}>
                    {item.name}
                  </Small>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.formGrid}>
            <View style={styles.formGridItem}>
              <TextField
                label={s.lineQuantityLabel}
                value={line.quantity}
                onChangeText={(text) => updateLine(index, { quantity: text })}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.formGridItem}>
              <TextField
                label={s.lineAmountLabel}
                value={line.amount}
                onChangeText={(text) => updateLine(index, { amount: text })}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          {lineErrors[index] ? <Small style={styles.errorText}>{lineErrors[index]}</Small> : null}
        </View>
      ))}

      <Button
        label={s.addAnotherItem}
        variant="secondary"
        onPress={() => setLines((c) => [...c, emptyLine()])}
      />

      <View style={styles.totalRow}>
        <Body style={styles.totalLabel}>{strings.purchase.total}</Body>
        <Body style={styles.totalValue}>{formatRupees(total)}</Body>
      </View>

      <Button label={s.save} variant="primary" onPress={handleSave} loading={saving} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  subtitle: {
    color: colours.muted,
    marginBottom: spacing.md,
  },
  lineCard: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  lineHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lineLabel: {
    fontFamily: fonts.bodyExtraBold,
  },
  removeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  itemChip: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.pill,
    backgroundColor: colours.card,
  },
  itemChipSelected: {
    borderColor: colours.primary,
    backgroundColor: colours.mint,
  },
  itemChipText: {
    color: colours.text,
  },
  itemChipTextSelected: {
    color: colours.text,
    fontFamily: fonts.bodyExtraBold,
  },
  formGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  formGridItem: {
    flex: 1,
    minWidth: 0,
  },
  errorText: {
    color: colours.danger,
    fontFamily: fonts.bodyExtraBold,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 2,
    borderTopColor: colours.mint,
    marginTop: spacing.sm,
  },
  totalLabel: {
    fontFamily: fonts.bodyExtraBold,
  },
  totalValue: {
    fontFamily: fonts.headingBold,
  },
});
