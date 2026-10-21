import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { CountFormItem } from '../api/counts';
import { ApiError } from '../api/client';
import type { WastageEntry, WastageReason } from '../api/wastage';
import { useAuth } from '../auth/AuthContext';
import { sectorCopyFor } from '../sectorCopy';
import { strings } from '../strings';
import { colours, fonts, radii, spacing } from '../theme/tokens';
import { Banner, Sheet } from '../ui';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { Body, Small } from '../ui/Text';

const s = strings.wastageForm;
const REASONS = Object.keys(s.reasons) as WastageReason[];

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: (entry: WastageEntry) => void;
  /** Pre-selects one item — Stock item detail's own "Record wastage" button. */
  initialStockItemId?: number;
};

/** Item, how much, reason, optional note. Used from Home, Today, the Wastage screen and Stock item
 * detail — the item list comes from counts/form/ (id/name/unit only), not stock-items/, since
 * Head chef and Helper can record wastage but can't see the full Stock screen. */
export function RecordWastageSheet({ visible, onClose, onSaved, initialStockItemId }: Props) {
  const { authedFetch, businesses } = useAuth();
  const business = businesses[0];
  const cfg = sectorCopyFor(business?.business_type ?? '');

  const [items, setItems] = useState<CountFormItem[]>([]);
  const [stockItemId, setStockItemId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<WastageReason>('spillage');
  const [note, setNote] = useState('');
  const [itemError, setItemError] = useState<string | null>(null);
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !business) return;
    authedFetch<{ items: CountFormItem[] }>(`/businesses/${business.id}/counts/form/?type=opening`)
      .then((response) => setItems(response.items))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, business?.id]);

  useEffect(() => {
    if (!visible) return;
    setStockItemId(initialStockItemId ?? null);
    setQuantity('');
    setReason('spillage');
    setNote('');
    setItemError(null);
    setQuantityError(null);
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialStockItemId]);

  async function handleSave() {
    setFormError(null);
    let hasError = false;
    if (!stockItemId) {
      setItemError(s.errors.itemRequired);
      hasError = true;
    } else {
      setItemError(null);
    }
    if (!quantity.trim()) {
      setQuantityError(s.errors.quantityRequired);
      hasError = true;
    } else {
      setQuantityError(null);
    }
    if (hasError || !business) return;

    setSaving(true);
    try {
      const entry = await authedFetch<WastageEntry>(`/businesses/${business.id}/wastage/`, {
        method: 'POST',
        body: { stock_item: stockItemId, quantity, reason, note: note.trim() },
      });
      onSaved(entry);
    } catch (err) {
      if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
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

      <View style={styles.field}>
        <Small style={styles.label}>{s.itemLabel}</Small>
        <View style={styles.chips}>
          {items.map((item) => {
            const selected = stockItemId === item.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => setStockItemId(item.id)}
                style={[styles.chip, selected ? styles.chipSelected : null]}
              >
                <Small style={selected ? styles.chipTextSelected : styles.chipText}>
                  {item.name}
                </Small>
              </Pressable>
            );
          })}
        </View>
        {itemError ? <Small style={styles.errorText}>{itemError}</Small> : null}
      </View>

      <TextField
        label={s.quantityLabel}
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="decimal-pad"
        error={quantityError ?? undefined}
      />

      <View style={styles.field}>
        <Small style={styles.label}>{s.reasonLabel}</Small>
        <Small style={styles.helpText}>{cfg.wastageHelp}</Small>
        <View style={styles.chips}>
          {REASONS.map((value) => {
            const selected = reason === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => setReason(value)}
                style={[styles.chip, selected ? styles.chipSelected : null]}
              >
                <Small style={selected ? styles.chipTextSelected : styles.chipText}>
                  {s.reasons[value]}
                </Small>
              </Pressable>
            );
          })}
        </View>
      </View>

      <TextField label={s.noteLabel} value={note} onChangeText={setNote} />

      <Button label={s.save} variant="primary" onPress={handleSave} loading={saving} />
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
    gap: spacing.sm,
  },
  label: {
    fontFamily: fonts.bodyExtraBold,
  },
  helpText: {
    color: colours.muted,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.pill,
    backgroundColor: colours.card,
  },
  chipSelected: {
    borderColor: colours.primary,
    backgroundColor: colours.mint,
  },
  chipText: {
    color: colours.text,
  },
  chipTextSelected: {
    color: colours.text,
    fontFamily: fonts.bodyExtraBold,
  },
  errorText: {
    color: colours.danger,
    fontFamily: fonts.bodyExtraBold,
  },
});
