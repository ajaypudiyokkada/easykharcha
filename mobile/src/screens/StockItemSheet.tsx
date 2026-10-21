import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { StockItem } from '../api/stock';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  EMPTY_STOCK_ITEM_DRAFT,
  StockItemForm,
  stockItemToDraft,
  type StockItemDraft,
} from '../forms/StockItemForm';
import { validateStockItemDraft } from '../forms/validateStockItem';
import { strings } from '../strings';
import { Banner, Button, Sheet } from '../ui';
import { spacing } from '../theme/tokens';

const ss = strings.settings.stock;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called once the save succeeds, with a toast message to show. */
  onSaved: (message: string) => void;
  editingItem: StockItem;
  /** This business's other stock items — for the "you already have X" check and group chips. */
  existingItems: StockItem[];
};

/**
 * Edit sheet for one stock item — Settings' "What you buy" list and Stock item detail's "Edit
 * item" button. Sends every field, not just the changed ones, so the form stays a plain controlled
 * component rather than needing to track a dirty subset. *Adding* a new item (Step 19) is inline
 * on the list screen itself now, not a sheet — see settings/stock.tsx and setup/3.tsx.
 */
export function StockItemSheet({ visible, onClose, onSaved, editingItem, existingItems }: Props) {
  const { authedFetch, businesses } = useAuth();
  const business = businesses[0];

  const [draft, setDraft] = useState<StockItemDraft>(EMPTY_STOCK_ITEM_DRAFT);
  const [errors, setErrors] = useState<ReturnType<typeof validateStockItemDraft>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const existingGroups = [...new Set(existingItems.map((item) => item.group).filter(Boolean))];

  useEffect(() => {
    if (!visible) return;
    setDraft(stockItemToDraft(editingItem));
    setErrors({});
    setFormError(null);
    // Only re-seed when the sheet opens or what it's editing changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingItem.id]);

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
    const nextErrors = validateStockItemDraft(
      draft,
      existingItems.filter((item) => item.id !== editingItem.id),
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !business) return;

    setSaving(true);
    try {
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
          group: draft.group.trim(),
          active: draft.active,
        },
      });
      onSaved(ss.savedToast);
    } catch (err) {
      mapError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={ss.editSheetTitle}>
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
          businessType={business?.business_type ?? ''}
          existingGroups={existingGroups}
          showActive
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
