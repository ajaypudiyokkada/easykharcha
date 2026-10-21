import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type TextInput } from 'react-native';

import type { SellItem, StockItem } from '../api/stock';
import type { UnitValue } from '../constants/units';
import { sectorCopyFor } from '../sectorCopy';
import { strings } from '../strings';
import { Banner, Body, Button, Icon, Small, TextField, Toggle } from '../ui';
import { MIN_TOUCH_TARGET } from '../ui/constants';
import { colours, fonts, radii, spacing } from '../theme/tokens';
import { groupItems } from './groupItems';
import { emptyStockItemDraft, StockItemForm, type StockItemDraft } from './StockItemForm';
import { convertedHint, convertToStockUnit, entryUnitsFor } from './unitConversion';

const sd = strings.dishForm;
const s3 = strings.setup.step3;

let nextRowKey = 0;

export type DishIngredientDraft = {
  /** Stable per-row key for list rendering/removal — not sent to the server. */
  key: string;
  stockItemId: number | null;
  /** What unit the amount is typed in — defaults to the stock item's own, but may be g/ml/pieces
   * when that's convertible to it (see unitConversion.ts). */
  entryUnit: UnitValue | '';
  amount: string;
};

export type DishDraft = {
  name: string;
  sellingPrice: string;
  portionLabel: string;
  group: string;
  ingredients: DishIngredientDraft[];
  active: boolean;
};

export const EMPTY_DISH_DRAFT: DishDraft = {
  name: '',
  sellingPrice: '',
  portionLabel: '',
  group: '',
  ingredients: [],
  active: true,
};

/** Builds the `ingredients` the server expects — each row's amount converted into the stock item's
 * own unit (see unitConversion.ts). Only call once validateDishDraft has confirmed every row is
 * complete; the non-null lookups here assume that's already true. */
export function ingredientsPayload(
  draft: DishDraft,
  stockItemsById: Map<number, StockItem>,
): { stock_item: number; quantity: string }[] {
  return draft.ingredients.map((row) => {
    const stockItem = stockItemsById.get(row.stockItemId as number)!;
    const amount = Number(row.amount.trim().replace(',', '.'));
    const converted = convertToStockUnit(
      amount,
      row.entryUnit as UnitValue,
      stockItem.unit as UnitValue,
    );
    return { stock_item: stockItem.id, quantity: (converted ?? amount).toFixed(3) };
  });
}

export function dishToDraft(item: SellItem): DishDraft {
  return {
    name: item.name,
    sellingPrice: item.selling_price,
    portionLabel: item.portion_label,
    group: item.group,
    active: item.active,
    ingredients: item.ingredients.map((ingredient) => ({
      key: `existing-${ingredient.id}`,
      stockItemId: ingredient.stock_item,
      entryUnit: ingredient.unit as UnitValue,
      amount: ingredient.quantity,
    })),
  };
}

function newRowKey(): string {
  nextRowKey += 1;
  return `new-${nextRowKey}`;
}

export type DishRowErrors = { stockItem?: string; amount?: string };

export type DishFieldErrors = {
  name?: string;
  price?: string;
  /** A general message shown under the ingredient list — "add at least one" or "fix the rows
   * below" — the per-row detail lives in `rows`. */
  ingredients?: string;
  rows?: Record<string, DishRowErrors>;
};

type Props = {
  value: DishDraft;
  onChange: (patch: Partial<DishDraft>) => void;
  errors?: DishFieldErrors;
  /** Drives every sector-varying placeholder and wording — see sectorCopy.ts. */
  businessType: string;
  /** Linkable (non-shared, active) stock items — null while still loading. */
  stockItems: StockItem[] | null;
  /** Saves one new stock item (the picker's "+ Add a new item") and returns it — the caller owns
   * the actual request, since this form has no fetch access of its own. */
  onAddStockItem: (draft: StockItemDraft) => Promise<StockItem>;
  existingGroups?: string[];
  /** Settings' edit sheet shows this; a brand-new dish never does. */
  showActive?: boolean;
  nameFieldRef?: React.Ref<TextInput>;
  onSave: () => void;
  saving?: boolean;
  saveLabel: string;
  formError?: string | null;
  /**
   * A future batch-confirm flow (AI/scan estimates reviewed one dish at a time) can drive this same
   * form through a "Dish 3 of 10 / Skip / Confirm and next" header instead of a plain Save button —
   * nothing creates that flow yet, so nothing passes these props this step.
   */
  stepLabel?: string;
  onSkip?: () => void;
  skipLabel?: string;
};

const SEARCH_ABOVE_ITEMS = 6;

/**
 * The dish form shared by Settings' "Add a dish" and its edit sheet (Step 22a) — name, price,
 * portion, group and a multi-row ingredient list (each row: a stock item, picked from a grouped,
 * searchable list with an inline "add a new stock item" escape hatch, and an amount in g/ml/pieces
 * or the stock item's own unit, converted before it's saved). Owns its own Save button (unlike the
 * thinner SellItemForm/StockItemForm) since the ingredient list has its own, fairly involved,
 * pick-then-fill-in flow.
 */
export function DishRecipeForm({
  value,
  onChange,
  errors,
  businessType,
  stockItems,
  onAddStockItem,
  existingGroups,
  showActive,
  nameFieldRef,
  onSave,
  saving,
  saveLabel,
  formError,
  stepLabel,
  onSkip,
  skipLabel,
}: Props) {
  const cfg = sectorCopyFor(businessType);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [addingStockItem, setAddingStockItem] = useState(false);
  const [newItemDraft, setNewItemDraft] = useState<StockItemDraft>(() =>
    emptyStockItemDraft(businessType),
  );
  const [newItemFieldErrors, setNewItemFieldErrors] = useState<{ name?: string; unit?: string }>(
    {},
  );
  const [newItemError, setNewItemError] = useState<string | null>(null);
  const [savingNewItem, setSavingNewItem] = useState(false);

  const stockItemsById = useMemo(() => {
    const map = new Map<number, StockItem>();
    for (const item of stockItems ?? []) map.set(item.id, item);
    return map;
  }, [stockItems]);

  const pickedIds = new Set(value.ingredients.map((row) => row.stockItemId));
  const pickable = (stockItems ?? []).filter((item) => !pickedIds.has(item.id));
  const filtered = useMemo(() => {
    const key = search.trim().toLowerCase();
    return key ? pickable.filter((item) => item.name.toLowerCase().includes(key)) : pickable;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickable, search]);
  const grouped = useMemo(() => groupItems(filtered), [filtered]);

  function setRows(rows: DishIngredientDraft[]) {
    onChange({ ingredients: rows });
  }

  function addIngredientRow(stockItem: StockItem) {
    setRows([
      ...value.ingredients,
      {
        key: newRowKey(),
        stockItemId: stockItem.id,
        entryUnit: stockItem.unit as UnitValue,
        amount: '',
      },
    ]);
    setPickerOpen(false);
    setSearch('');
  }

  function updateRow(key: string, patch: Partial<DishIngredientDraft>) {
    setRows(value.ingredients.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setRows(value.ingredients.filter((row) => row.key !== key));
  }

  async function handleAddStockItem() {
    setNewItemError(null);
    const fieldErrors: { name?: string; unit?: string } = {};
    if (!newItemDraft.name.trim()) fieldErrors.name = s3.errors.nameRequired;
    if (!newItemDraft.unit) fieldErrors.unit = s3.errors.unitRequired;
    setNewItemFieldErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setSavingNewItem(true);
    try {
      const created = await onAddStockItem(newItemDraft);
      addIngredientRow(created);
      setAddingStockItem(false);
      setNewItemDraft(emptyStockItemDraft(businessType));
      setNewItemFieldErrors({});
    } catch {
      setNewItemError(sd.errors.generic);
    } finally {
      setSavingNewItem(false);
    }
  }

  return (
    <View style={styles.field}>
      {stepLabel ? (
        <View style={styles.stepRow}>
          <Small style={styles.stepLabel}>{stepLabel}</Small>
          {onSkip ? (
            <Pressable accessibilityRole="button" onPress={onSkip}>
              <Small style={styles.skipLink}>{skipLabel}</Small>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {formError ? <Banner kind="error">{formError}</Banner> : null}

      <TextField
        ref={nameFieldRef}
        label={sd.nameLabel}
        value={value.name}
        onChangeText={(name) => onChange({ name })}
        placeholder={cfg.sellNamePlaceholder}
        maxLength={120}
        error={errors?.name}
      />

      <TextField
        label={sd.priceLabel}
        value={value.sellingPrice}
        onChangeText={(sellingPrice) => onChange({ sellingPrice })}
        placeholder={sd.pricePlaceholder}
        keyboardType="decimal-pad"
        error={errors?.price}
      />

      <TextField
        label={sd.portionLabel}
        value={value.portionLabel}
        onChangeText={(portionLabel) => onChange({ portionLabel })}
        placeholder={cfg.sellPortionPlaceholder}
        maxLength={40}
      />

      <View style={styles.field}>
        <Small style={styles.sectionLabel}>{cfg.usesLabel}</Small>
        <Small style={styles.introText}>{cfg.usesHelp}</Small>

        {stockItems !== null && stockItems.length === 0 ? (
          <Small style={styles.introText}>{sd.noStockItemsYet}</Small>
        ) : null}

        {value.ingredients.map((row) => {
          const stockItem = row.stockItemId !== null ? stockItemsById.get(row.stockItemId) : null;
          const rowError = errors?.rows?.[row.key];
          const entryUnits = stockItem ? entryUnitsFor(stockItem.unit as UnitValue) : [];
          const amountNumber = Number(row.amount.trim().replace(',', '.'));
          const hint =
            stockItem && row.entryUnit && !Number.isNaN(amountNumber) && row.amount.trim()
              ? convertedHint(amountNumber, row.entryUnit as UnitValue, stockItem.unit as UnitValue)
              : null;
          return (
            <View key={row.key} style={styles.ingredientRow}>
              <View style={styles.ingredientHead}>
                <Body style={styles.ingredientName}>{stockItem?.name ?? '—'}</Body>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${sd.removeIngredient} ${stockItem?.name ?? ''}`}
                  onPress={() => removeRow(row.key)}
                  style={styles.removeButton}
                >
                  <Icon name="delete" size={18} colour={colours.danger} />
                </Pressable>
              </View>
              {rowError?.stockItem ? (
                <Small style={styles.errorText}>{rowError.stockItem}</Small>
              ) : null}

              <TextField
                label={sd.amountLabel}
                value={row.amount}
                onChangeText={(amount) => updateRow(row.key, { amount })}
                placeholder={sd.amountPlaceholder}
                keyboardType="decimal-pad"
                hint={hint ?? undefined}
                error={rowError?.amount}
              />

              {entryUnits.length > 1 ? (
                <View style={styles.unitRow}>
                  {entryUnits.map((unit) => (
                    <Pressable
                      key={unit}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: row.entryUnit === unit }}
                      onPress={() => updateRow(row.key, { entryUnit: unit })}
                      style={[
                        styles.unitChip,
                        row.entryUnit === unit ? styles.unitChipSelected : null,
                      ]}
                    >
                      <Small
                        style={
                          row.entryUnit === unit ? styles.unitChipTextSelected : styles.unitChipText
                        }
                      >
                        {unit}
                      </Small>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}

        {errors?.ingredients ? <Small style={styles.errorText}>{errors.ingredients}</Small> : null}

        {pickerOpen ? (
          stockItems === null ? (
            <ActivityIndicator color={colours.primary} />
          ) : (
            <View style={styles.pickerPanel}>
              <Body style={styles.pickerTitle}>{sd.pickIngredientTitle}</Body>
              {pickable.length > SEARCH_ABOVE_ITEMS ? (
                <TextField
                  label={sd.searchStockItems}
                  value={search}
                  onChangeText={setSearch}
                  placeholder={sd.searchStockItems}
                  left={<Icon name="search" size={16} colour={colours.muted} />}
                />
              ) : null}

              {grouped.map(({ group, items }) => (
                <View key={group} style={styles.groupBlock}>
                  {grouped.length > 1 ? <Small style={styles.groupLabel}>{group}</Small> : null}
                  <View style={styles.unitRow}>
                    {items.map((item) => (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        onPress={() => addIngredientRow(item)}
                        style={styles.unitChip}
                      >
                        <Small style={styles.unitChipText}>{item.name}</Small>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}

              <Pressable
                accessibilityRole="button"
                onPress={() => setAddingStockItem((current) => !current)}
                style={styles.addNewButton}
              >
                <Small style={styles.addNewButtonText}>{sd.addNewStockItem}</Small>
              </Pressable>

              {addingStockItem ? (
                <View style={styles.addNewPanel}>
                  <Body style={styles.addNewTitle}>{sd.addNewStockItemTitle}</Body>
                  {newItemError ? <Banner kind="error">{newItemError}</Banner> : null}
                  <StockItemForm
                    value={newItemDraft}
                    onChange={(patch) => setNewItemDraft((current) => ({ ...current, ...patch }))}
                    errors={newItemFieldErrors}
                    businessType={businessType}
                  />
                  <Button
                    label={s3.addItem}
                    variant="primary"
                    onPress={handleAddStockItem}
                    loading={savingNewItem}
                  />
                </View>
              ) : null}
            </View>
          )
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setPickerOpen(true)}
            style={styles.addNewButton}
          >
            <Small style={styles.addNewButtonText}>{sd.addIngredient}</Small>
          </Pressable>
        )}
      </View>

      <View style={styles.field}>
        <TextField
          label={sd.groupLabel}
          value={value.group}
          onChangeText={(group) => onChange({ group })}
          placeholder={cfg.sellGroupPlaceholder}
          maxLength={40}
        />
        <View style={styles.unitRow}>
          {(existingGroups && existingGroups.length > 0 ? existingGroups : cfg.sellGroupSuggestions)
            .filter((group) => group.toLowerCase() !== value.group.trim().toLowerCase())
            .map((group) => (
              <Pressable
                key={group}
                accessibilityRole="button"
                onPress={() => onChange({ group })}
                style={styles.groupChip}
              >
                <Small style={styles.groupChipText}>{group}</Small>
              </Pressable>
            ))}
        </View>
      </View>

      {showActive ? (
        <Toggle
          title={sd.activeToggle}
          value={value.active}
          onChange={(active) => onChange({ active })}
        />
      ) : null}

      <Button label={saveLabel} variant="primary" onPress={onSave} loading={saving} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepLabel: {
    color: colours.muted,
    fontFamily: fonts.bodyExtraBold,
  },
  skipLink: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
  sectionLabel: {
    fontFamily: fonts.bodyExtraBold,
  },
  introText: {
    color: colours.muted,
  },
  ingredientRow: {
    gap: spacing.xs,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  ingredientHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ingredientName: {
    fontFamily: fonts.bodyExtraBold,
  },
  removeButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  groupBlock: {
    gap: spacing.xs,
  },
  groupLabel: {
    color: colours.muted,
    fontFamily: fonts.bodyExtraBold,
  },
  unitChip: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.pill,
    backgroundColor: colours.card,
  },
  unitChipSelected: {
    borderColor: colours.primary,
    backgroundColor: colours.mint,
  },
  unitChipText: {
    color: colours.text,
  },
  unitChipTextSelected: {
    color: colours.text,
    fontFamily: fonts.bodyExtraBold,
  },
  groupChip: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.pill,
    backgroundColor: colours.card,
  },
  groupChipText: {
    color: colours.muted,
  },
  addNewButton: {
    alignSelf: 'flex-start',
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  addNewButtonText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
  addNewPanel: {
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  addNewTitle: {
    fontFamily: fonts.bodyExtraBold,
  },
  pickerPanel: {
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  pickerTitle: {
    fontFamily: fonts.bodyExtraBold,
  },
  errorText: {
    color: colours.danger,
    fontFamily: fonts.bodyExtraBold,
  },
});
