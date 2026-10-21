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
import type { StockItemDraft } from '../forms/StockItemForm';
import { validateSellItemDraft } from '../forms/validateSellItem';
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
  /** New stock items added inline via the picker's "+ Add a new item" land here too, so the
   * picker's own list (and Settings' "What you buy", once reopened) sees them. */
  onStockItemAdded: (item: StockItem) => void;
  editingItem: SellItem;
  existingItems: SellItem[];
};

/**
 * Edit sheet for one sell item — Settings' "What you sell" list. *Adding* a new item (Step 19) is
 * inline on the list screen itself now, not a sheet — see settings/sell.tsx and setup/4.tsx.
 */
export function SellItemSheet({
  visible,
  onClose,
  onSaved,
  stockItems,
  onStockItemAdded,
  editingItem,
  existingItems,
}: Props) {
  const { authedFetch, businesses } = useAuth();
  const business = businesses[0];

  const [draft, setDraft] = useState<SellItemDraft>(EMPTY_SELL_ITEM_DRAFT);
  const [errors, setErrors] = useState<ReturnType<typeof validateSellItemDraft>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const existingGroups = [...new Set(existingItems.map((item) => item.group).filter(Boolean))];

  useEffect(() => {
    if (!visible) return;
    setDraft(sellItemToDraft(editingItem));
    setErrors({});
    setFormError(null);
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

  async function handleAddStockItem(stockDraft: StockItemDraft): Promise<StockItem> {
    const results = await authedFetch<StockItem[]>(
      `/businesses/${business!.id}/stock-items/bulk/`,
      {
        method: 'POST',
        body: {
          items: [
            {
              name: stockDraft.name.trim(),
              unit: stockDraft.unit,
              usual_price: stockDraft.usualPrice.trim() || undefined,
              supplier: stockDraft.supplier.trim() || undefined,
              shared: stockDraft.shared,
              goes_off: stockDraft.goesOff,
              shelf_life_days:
                stockDraft.goesOff && stockDraft.shelfLifeDays.trim()
                  ? Number(stockDraft.shelfLifeDays)
                  : undefined,
              group: stockDraft.group.trim() || undefined,
            },
          ],
        },
      },
    );
    const created = results[0];
    onStockItemAdded(created);
    return created;
  }

  async function handleSave() {
    setFormError(null);
    const nextErrors = validateSellItemDraft(
      draft,
      existingItems.filter((item) => item.id !== editingItem.id),
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !business) return;

    setSaving(true);
    try {
      await authedFetch(`/businesses/${business.id}/sell-items/${editingItem.id}/`, {
        method: 'PATCH',
        body: {
          name: draft.name.trim(),
          selling_price: draft.sellingPrice.trim(),
          main_stock_item: draft.mainStockItemId,
          uses_qty: draft.mainStockItemId !== null ? draft.usesQty.trim() || null : null,
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
        <SellItemForm
          value={draft}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          errors={errors}
          businessType={business?.business_type ?? ''}
          stockItems={stockItems}
          onAddStockItem={handleAddStockItem}
          showUsesQty
          showActive
          existingGroups={existingGroups}
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
