import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ApiError } from '../api/client';
import type { SellItem, StockItem } from '../api/stock';
import { useAuth } from '../auth/AuthContext';
import {
  EMPTY_SELL_ITEM_DRAFT,
  SellItemForm,
  sellItemToDraft,
  type SellItemDraft,
} from '../forms/SellItemForm';
import { strings } from '../strings';
import { Banner, Button, Sheet } from '../ui';
import { spacing } from '../theme/tokens';

const ss = strings.settings.sell;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called once the save succeeds, with a toast message to show. */
  onSaved: (message: string) => void;
  /** Linkable (non-shared) stock items for the "main stock item" picker — null while loading. */
  stockItems: StockItem[] | null;
  /** Omit (or pass null) to add a new item instead of editing an existing one. */
  editingItem?: SellItem | null;
};

/**
 * Add/edit sheet for one sell item, shared by Settings' "What you sell" list — same shape as
 * StockItemSheet (bulk endpoint for add, full-field PATCH for edit).
 */
export function SellItemSheet({ visible, onClose, onSaved, stockItems, editingItem }: Props) {
  const { authedFetch, businesses } = useAuth();
  const business = businesses[0];

  const [draft, setDraft] = useState<SellItemDraft>(EMPTY_SELL_ITEM_DRAFT);
  const [errors, setErrors] = useState<{ name?: string; price?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDraft(editingItem ? sellItemToDraft(editingItem) : EMPTY_SELL_ITEM_DRAFT);
    setErrors({});
    setFormError(null);
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
    const nextErrors: { name?: string; price?: string } = {};
    if (!draft.name.trim()) nextErrors.name = ss.errors.nameRequired;
    if (!draft.sellingPrice.trim()) nextErrors.price = ss.errors.priceRequired;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !business) return;

    setSaving(true);
    try {
      if (editingItem) {
        await authedFetch(`/businesses/${business.id}/sell-items/${editingItem.id}/`, {
          method: 'PATCH',
          body: {
            name: draft.name.trim(),
            selling_price: draft.sellingPrice.trim(),
            main_stock_item: draft.mainStockItemId,
            uses_qty: draft.mainStockItemId !== null ? draft.usesQty.trim() || null : null,
            active: draft.active,
          },
        });
        onSaved(ss.savedToast);
      } else {
        await authedFetch(`/businesses/${business.id}/sell-items/bulk/`, {
          method: 'POST',
          body: {
            items: [
              {
                name: draft.name.trim(),
                selling_price: draft.sellingPrice.trim(),
                main_stock_item: draft.mainStockItemId ?? undefined,
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
        <SellItemForm
          value={draft}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          errors={errors}
          stockItems={stockItems}
          showUsesQty={Boolean(editingItem)}
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
