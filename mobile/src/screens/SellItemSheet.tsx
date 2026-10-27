import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Base } from '../api/bases';
import { ApiError } from '../api/client';
import type { Business } from '../api/business';
import type { SellItem, StockItem } from '../api/stock';
import { useAuth } from '../auth/AuthContext';
import {
  basesPayload,
  DishRecipeForm,
  dishToDraft,
  EMPTY_DISH_DRAFT,
  ingredientsPayload,
  type DishDraft,
} from '../forms/DishRecipeForm';
import type { StockItemDraft } from '../forms/StockItemForm';
import { validateDishDraft } from '../forms/validateDish';
import { strings } from '../strings';
import { spacing } from '../theme/tokens';
import { Sheet } from '../ui';

const sd = strings.dishForm;

type Props = {
  visible: boolean;
  /** The business this dish belongs to — the caller's own active/onboarding business, since
   * that's not always `businesses[0]` (e.g. onboarding a second business). */
  business: Business | undefined;
  onClose: () => void;
  /** Called once the save succeeds, with a toast message to show. */
  onSaved: (message: string) => void;
  /** Linkable (non-shared, active) stock items for the ingredient picker — null while loading. */
  stockItems: StockItem[] | null;
  /** Step 42b1c1: this business's batch recipes, for the "use a batch recipe" picker — undefined
   * hides that section entirely. */
  bases?: Base[] | null;
  /** New stock items added inline via the picker's "+ Add a new item" land here too, so the
   * picker's own list (and Settings' "What you buy", once reopened) sees them. */
  onStockItemAdded: (item: StockItem) => void;
  /** null means "Add a dish" (create); otherwise this is the dish being edited. */
  editingItem: SellItem | null;
  existingItems: SellItem[];
};

/**
 * The dish add/edit sheet (Step 22a), reused by both Settings' "What you sell" and (Step 22a2) the
 * onboarding wizard's "What you sell" step — one dish, its portion and its full ingredient list,
 * via DishRecipeForm. Create (editingItem null) posts sell-items/; edit PATCHes sell-items/<id>/ —
 * both always land at recipe_status=confirmed, since the form requires at least one valid
 * ingredient before Save does anything.
 */
export function SellItemSheet({
  visible,
  business,
  onClose,
  onSaved,
  stockItems,
  bases,
  onStockItemAdded,
  editingItem,
  existingItems,
}: Props) {
  const { authedFetch } = useAuth();

  const [draft, setDraft] = useState<DishDraft>(EMPTY_DISH_DRAFT);
  const [errors, setErrors] = useState<ReturnType<typeof validateDishDraft>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const existingGroups = [...new Set(existingItems.map((item) => item.group).filter(Boolean))];
  const stockItemsById = useMemo(() => {
    const map = new Map<number, StockItem>();
    for (const item of stockItems ?? []) map.set(item.id, item);
    return map;
  }, [stockItems]);

  useEffect(() => {
    if (!visible) return;
    setDraft(editingItem ? dishToDraft(editingItem) : EMPTY_DISH_DRAFT);
    setErrors({});
    setFormError(null);
  }, [visible, editingItem]);

  function mapError(err: unknown) {
    if (err instanceof ApiError && err.rowErrors && err.rowErrors[0]) {
      setFormError(err.rowErrors[0].message);
    } else if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
      setFormError(sd.errors.network);
    } else if (err instanceof ApiError) {
      setFormError(err.message || sd.errors.generic);
    } else {
      setFormError(sd.errors.generic);
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
    const nextErrors = validateDishDraft(
      draft,
      existingItems.filter((item) => item.id !== editingItem?.id),
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !business) return;

    const body = {
      name: draft.name.trim(),
      selling_price: draft.sellingPrice.trim(),
      portion_label: draft.portionLabel.trim(),
      group: draft.group.trim(),
      ingredients: ingredientsPayload(draft, stockItemsById),
      bases: basesPayload(draft),
      ...(editingItem ? { active: draft.active } : {}),
    };

    setSaving(true);
    try {
      if (editingItem) {
        await authedFetch(`/businesses/${business.id}/sell-items/${editingItem.id}/`, {
          method: 'PATCH',
          body,
        });
      } else {
        await authedFetch(`/businesses/${business.id}/sell-items/`, { method: 'POST', body });
      }
      onSaved(editingItem ? sd.savedToast : sd.addedToast);
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
      title={editingItem ? sd.editSheetTitle : sd.addSheetTitle}
    >
      <View style={styles.formWrap}>
        <DishRecipeForm
          value={draft}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          errors={errors}
          businessType={business?.business_type ?? ''}
          stockItems={stockItems}
          bases={bases}
          onAddStockItem={handleAddStockItem}
          existingGroups={existingGroups}
          showActive={Boolean(editingItem)}
          formError={formError}
          onSave={handleSave}
          saving={saving}
          saveLabel={sd.save}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  formWrap: {
    marginBottom: spacing.lg,
  },
});
