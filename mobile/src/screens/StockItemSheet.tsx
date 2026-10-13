import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ApiError } from '../api/client';
import type { StockItem } from '../api/stock';
import { useAuth } from '../auth/AuthContext';
import {
  EMPTY_STOCK_ITEM_DRAFT,
  StockItemForm,
  stockItemToDraft,
  type StockItemDraft,
} from '../forms/StockItemForm';
import { strings } from '../strings';
import { Banner, Button, Sheet } from '../ui';
import { spacing } from '../theme/tokens';

const ss = strings.settings.stock;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called once the save succeeds, with a toast message to show. */
  onSaved: (message: string) => void;
  /** Omit (or pass null) to add a new item instead of editing an existing one. */
  editingItem?: StockItem | null;
};

/**
 * Add/edit sheet for one stock item, shared by Settings' "What you buy" list and Stock item
 * detail's "Edit item" button. Adding reuses the bulk endpoint with a single row (there's no
 * separate single-create endpoint); editing sends every field, not just the changed ones, so the
 * form stays a plain controlled component rather than needing to track a dirty subset.
 */
export function StockItemSheet({ visible, onClose, onSaved, editingItem }: Props) {
  const { authedFetch, businesses } = useAuth();
  const business = businesses[0];

  const [draft, setDraft] = useState<StockItemDraft>(EMPTY_STOCK_ITEM_DRAFT);
  const [errors, setErrors] = useState<{ name?: string; unit?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDraft(editingItem ? stockItemToDraft(editingItem) : EMPTY_STOCK_ITEM_DRAFT);
    setErrors({});
    setFormError(null);
    // Only re-seed when the sheet opens or what it's editing changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingItem?.id]);

  function mapError(err: unknown) {
    if (err instanceof ApiError && err.rowErrors && err.rowErrors[0]) {
      setFormError(err.rowErrors[0].message);
    } else if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
      setFormError(ss.errors.network);
    } else if (err instanceof ApiError) {
      setFormError(err.message || ss.errors.generic);
    } else {
      setFormError(ss.errors.generic);
    }
  }

  async function handleSave() {
    setFormError(null);
    const nextErrors: { name?: string; unit?: string } = {};
    if (!draft.name.trim()) nextErrors.name = ss.errors.nameRequired;
    if (!draft.unit) nextErrors.unit = ss.errors.unitRequired;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !business) return;

    setSaving(true);
    try {
      if (editingItem) {
        await authedFetch(`/businesses/${business.id}/stock-items/${editingItem.id}/`, {
          method: 'PATCH',
          body: {
            name: draft.name.trim(),
            unit: draft.unit,
            usual_price: draft.usualPrice.trim() || null,
            supplier: draft.supplier.trim(),
            shared: draft.shared,
            goes_off: draft.goesOff,
            shelf_life_days:
              draft.goesOff && draft.shelfLifeDays.trim() ? Number(draft.shelfLifeDays) : null,
            active: draft.active,
          },
        });
        onSaved(ss.savedToast);
      } else {
        await authedFetch(`/businesses/${business.id}/stock-items/bulk/`, {
          method: 'POST',
          body: {
            items: [
              {
                name: draft.name.trim(),
                unit: draft.unit,
                usual_price: draft.usualPrice.trim() || undefined,
                supplier: draft.supplier.trim() || undefined,
                shared: draft.shared,
                goes_off: draft.goesOff,
                shelf_life_days:
                  draft.goesOff && draft.shelfLifeDays.trim()
                    ? Number(draft.shelfLifeDays)
                    : undefined,
              },
            ],
          },
        });
        onSaved(ss.addedToast);
      }
    } catch (err) {
      mapError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={editingItem ? ss.editSheetTitle : ss.addSheetTitle}
    >
      {formError ? (
        <View style={styles.banner}>
          <Banner kind="error">{formError}</Banner>
        </View>
      ) : null}
      <View style={styles.formWrap}>
        <StockItemForm
          value={draft}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          errors={errors}
          showActive={Boolean(editingItem)}
        />
      </View>
      <Button label={ss.save} variant="primary" onPress={handleSave} loading={saving} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginBottom: spacing.md,
  },
  formWrap: {
    marginBottom: spacing.lg,
  },
});
