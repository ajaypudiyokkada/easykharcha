import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ApiError } from '../api/client';
import type { Purchase } from '../api/purchases';
import type { StockItem } from '../api/stock';
import { useAuth } from '../auth/AuthContext';
import { formatRupees } from '../format';
import { strings } from '../strings';
import { colours, fonts, radii, spacing } from '../theme/tokens';
import { Banner, Body, Button, Icon, Sheet, Small, TextField } from '../ui';

const s = strings.purchase;

type LineDraft = {
  stockItemId: number | null;
  quantity: string;
  unitPrice: string;
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function emptyLine(stockItemId: number | null = null): LineDraft {
  return { stockItemId, quantity: '', unitPrice: '' };
}

function lineTotal(line: LineDraft): number {
  const qty = Number(line.quantity);
  const price = Number(line.unitPrice);
  if (!Number.isFinite(qty) || !Number.isFinite(price)) return 0;
  return qty * price;
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: (purchase: Purchase) => void;
  /** Pre-fills one line — Stock item detail's own "Record purchase" button. */
  initialStockItemId?: number;
  /** When set, the sheet edits this purchase instead of creating a new one. */
  editingPurchase?: Purchase | null;
};

/**
 * Supplier (type to search or add), date and time, one or more lines, a running total, Save. Used
 * from Home's quick action, the Buy screen, Stock item detail, and Purchase detail's "Edit purchase".
 */
export function RecordPurchaseSheet({
  visible,
  onClose,
  onSaved,
  initialStockItemId,
  editingPurchase,
}: Props) {
  const { authedFetch, businesses } = useAuth();
  const business = businesses[0];

  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [supplierNames, setSupplierNames] = useState<string[]>([]);
  const [supplier, setSupplier] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [dateTime, setDateTime] = useState(() => toLocalInput(new Date()));
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !business) return;
    authedFetch<StockItem[]>(`/businesses/${business.id}/stock-items/`)
      .then(setStockItems)
      .catch(() => {});
    authedFetch<string[]>(`/businesses/${business.id}/suppliers/`)
      .then(setSupplierNames)
      .catch(() => {});
    // Fetched fresh every time the sheet opens — a short-lived form, not worth caching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, business?.id]);

  useEffect(() => {
    if (!visible) return;
    if (editingPurchase) {
      setSupplier(editingPurchase.supplier_name ?? '');
      setDateTime(toLocalInput(new Date(editingPurchase.purchase_date_time)));
      setNote(editingPurchase.note);
      setLines(
        editingPurchase.lines.map((line) => ({
          stockItemId: line.stock_item,
          quantity: line.quantity,
          unitPrice: line.unit_price,
        })),
      );
    } else {
      setSupplier('');
      setDateTime(toLocalInput(new Date()));
      setNote('');
      setLines([emptyLine(initialStockItemId ?? null)]);
    }
    setLineErrors({});
    setFormError(null);
    // Only re-seed when the sheet transitions to visible or what it's editing changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingPurchase?.id, initialStockItemId]);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, i) => i !== index));
  }

  const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);

  async function handleSave() {
    setFormError(null);
    const errors: Record<number, string> = {};
    lines.forEach((line, index) => {
      if (!line.stockItemId) errors[index] = s.errors.itemRequired;
      else if (!line.quantity.trim()) errors[index] = s.errors.quantityRequired;
      else if (!line.unitPrice.trim()) errors[index] = s.errors.priceRequired;
    });
    setLineErrors(errors);
    if (Object.keys(errors).length > 0 || !business) return;

    setSaving(true);
    try {
      const payload = {
        supplier_name: supplier.trim(),
        purchase_date_time: new Date(dateTime).toISOString(),
        note: note.trim(),
        lines: lines.map((line) => ({
          stock_item: line.stockItemId,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          line_total: lineTotal(line).toFixed(2),
        })),
      };
      const purchase = editingPurchase
        ? await authedFetch<Purchase>(
            `/businesses/${business.id}/purchases/${editingPurchase.id}/`,
            {
              method: 'PATCH',
              body: payload,
            },
          )
        : await authedFetch<Purchase>(`/businesses/${business.id}/purchases/`, {
            method: 'POST',
            body: payload,
          });
      onSaved(purchase);
    } catch (err) {
      if (err instanceof ApiError && err.rowErrors) {
        const nextErrors: Record<number, string> = {};
        for (const rowErr of err.rowErrors) nextErrors[rowErr.row - 1] = rowErr.message;
        setLineErrors(nextErrors);
        setFormError(s.errors.generic);
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

  const trimmedSupplier = supplier.trim().toLowerCase();
  const matchingSuppliers = trimmedSupplier
    ? supplierNames.filter(
        (name) =>
          name.toLowerCase().includes(trimmedSupplier) && name.toLowerCase() !== trimmedSupplier,
      )
    : [];

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={editingPurchase ? s.editSheetTitle : s.sheetTitle}
    >
      <Body style={styles.subtitle}>{s.sheetSubtitle}</Body>
      {formError ? <Banner kind="error">{formError}</Banner> : null}

      <View style={styles.field}>
        <TextField
          label={s.supplierLabel}
          value={supplier}
          onChangeText={(text) => {
            setSupplier(text);
            setShowSuggestions(true);
          }}
          placeholder={s.supplierPlaceholder}
        />
        {showSuggestions && matchingSuppliers.length > 0 ? (
          <View style={styles.suggestions}>
            {matchingSuppliers.slice(0, 5).map((name) => (
              <Pressable
                key={name}
                accessibilityRole="button"
                style={styles.suggestionRow}
                onPress={() => {
                  setSupplier(name);
                  setShowSuggestions(false);
                }}
              >
                <Small>{name}</Small>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <TextField label={s.dateLabel} value={dateTime} onChangeText={setDateTime} />

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
            {stockItems.map((item) => {
              const selected = line.stockItemId === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => updateLine(index, { stockItemId: item.id })}
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
            <TextField
              label={s.lineQuantityLabel}
              value={line.quantity}
              onChangeText={(text) => updateLine(index, { quantity: text })}
              keyboardType="decimal-pad"
            />
            <TextField
              label={s.lineUnitPriceLabel}
              value={line.unitPrice}
              onChangeText={(text) => updateLine(index, { unitPrice: text })}
              keyboardType="decimal-pad"
            />
          </View>
          <Small style={styles.lineTotal}>
            {s.lineTotalLabel}: {formatRupees(lineTotal(line))}
          </Small>
          {lineErrors[index] ? <Small style={styles.errorText}>{lineErrors[index]}</Small> : null}
        </View>
      ))}

      <Button
        label={s.addAnotherItem}
        variant="secondary"
        onPress={() => setLines((c) => [...c, emptyLine()])}
      />

      <TextField label={s.noteLabel} value={note} onChangeText={setNote} />

      <View style={styles.totalRow}>
        <Body style={styles.totalLabel}>{s.total}</Body>
        <Body style={styles.totalValue}>{formatRupees(total)}</Body>
      </View>

      <Button
        label={editingPurchase ? s.saveEdit : s.save}
        variant="primary"
        onPress={handleSave}
        loading={saving}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  subtitle: {
    color: colours.muted,
    marginBottom: spacing.md,
  },
  field: {
    marginBottom: spacing.md,
  },
  suggestions: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  suggestionRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colours.mint,
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
  lineTotal: {
    color: colours.muted,
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
