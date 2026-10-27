import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';

import type { Base } from '../api/bases';
import type { StockItem } from '../api/stock';
import { strings } from '../strings';
import { Body, Icon, Small, TextField } from '../ui';
import { MIN_TOUCH_TARGET } from '../ui/constants';
import { colours, fonts, radii, spacing } from '../theme/tokens';

const bs = strings.settings.bases;

let nextRowKey = 0;

export type BaseIngredientDraft = {
  key: string;
  stockItemId: number | null;
  amount: string;
};

export type BaseDraft = {
  name: string;
  unitFamily: 'weight' | 'volume';
  batchYieldQty: string;
  ingredients: BaseIngredientDraft[];
};

export const EMPTY_BASE_DRAFT: BaseDraft = {
  name: '',
  unitFamily: 'weight',
  batchYieldQty: '1000',
  ingredients: [],
};

function newRowKey(): string {
  nextRowKey += 1;
  return `base-row-${nextRowKey}`;
}

export function baseToDraft(base: Base): BaseDraft {
  return {
    name: base.name,
    unitFamily: base.unit_family,
    batchYieldQty: base.batch_yield_qty,
    ingredients: base.ingredients.map((ingredient) => ({
      key: `existing-${ingredient.id}`,
      stockItemId: ingredient.stock_item,
      amount: ingredient.quantity_per_1000,
    })),
  };
}

export function baseIngredientsPayload(
  draft: BaseDraft,
): { stock_item: number; quantity: string }[] {
  return draft.ingredients.map((row) => ({
    stock_item: row.stockItemId as number,
    quantity: row.amount.trim().replace(',', '.'),
  }));
}

export type BaseRowErrors = { stockItem?: string; amount?: string };
export type BaseFieldErrors = {
  name?: string;
  ingredients?: string;
  rows?: Record<string, BaseRowErrors>;
};

type Props = {
  value: BaseDraft;
  onChange: (patch: Partial<BaseDraft>) => void;
  errors?: BaseFieldErrors;
  /** Every stock item this business can use (non-shared, active) — null while still loading. */
  stockItems: StockItem[] | null;
  nameFieldRef?: React.Ref<TextInput>;
};

const SEARCH_ABOVE_ITEMS = 6;

/**
 * The batch-recipe ("base") form shared by Settings' add/edit sheets (Step 42b1c1) — name, a
 * "this batch makes" yield (defaults to 1,000 g/ml), and a multi-row ingredient list. Deliberately
 * simpler than DishRecipeForm's: a base ingredient's amount is always already in the stock item's
 * own base unit (no entry-unit picker), matching how BaseIngredient is stored.
 */
export function BaseRecipeForm({ value, onChange, errors, stockItems, nameFieldRef }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const pickedIds = new Set(value.ingredients.map((row) => row.stockItemId));
  const pickable = (stockItems ?? []).filter((item) => !pickedIds.has(item.id));
  const filtered = useMemo(() => {
    const key = search.trim().toLowerCase();
    return key ? pickable.filter((item) => item.name.toLowerCase().includes(key)) : pickable;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickable, search]);

  function setRows(rows: BaseIngredientDraft[]) {
    onChange({ ingredients: rows });
  }

  function addRow(stockItem: StockItem) {
    setRows([...value.ingredients, { key: newRowKey(), stockItemId: stockItem.id, amount: '' }]);
    setPickerOpen(false);
    setSearch('');
  }

  function updateRow(key: string, patch: Partial<BaseIngredientDraft>) {
    setRows(value.ingredients.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setRows(value.ingredients.filter((row) => row.key !== key));
  }

  const stockItemsById = new Map((stockItems ?? []).map((item) => [item.id, item]));
  const unitLabel = value.unitFamily === 'volume' ? 'ml' : 'g';

  return (
    <View style={styles.field}>
      <TextField
        ref={nameFieldRef}
        label={bs.nameLabel}
        value={value.name}
        onChangeText={(name) => onChange({ name })}
        placeholder={bs.namePlaceholder}
        maxLength={120}
        error={errors?.name}
      />

      <TextField
        label={`${bs.yieldLabel} (${unitLabel})`}
        value={value.batchYieldQty}
        onChangeText={(batchYieldQty) => onChange({ batchYieldQty })}
        keyboardType="decimal-pad"
      />
      <Small style={styles.introText}>{bs.yieldNote}</Small>

      <View style={styles.field}>
        <Small style={styles.sectionLabel}>{bs.ingredientsLabel}</Small>

        {stockItems !== null && stockItems.length === 0 ? (
          <Small style={styles.introText}>{bs.noStockItemsYet}</Small>
        ) : null}

        {value.ingredients.map((row) => {
          const stockItem = row.stockItemId !== null ? stockItemsById.get(row.stockItemId) : null;
          const rowError = errors?.rows?.[row.key];
          return (
            <View key={row.key} style={styles.row}>
              <View style={styles.rowHead}>
                <Body style={styles.rowName}>{stockItem?.name ?? '—'}</Body>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${bs.removeIngredient} ${stockItem?.name ?? ''}`}
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
                label={`${bs.amountLabel} (${stockItem?.unit ?? unitLabel})`}
                value={row.amount}
                onChangeText={(amount) => updateRow(row.key, { amount })}
                placeholder={bs.amountPlaceholder}
                keyboardType="decimal-pad"
                error={rowError?.amount}
              />
            </View>
          );
        })}

        {errors?.ingredients ? <Small style={styles.errorText}>{errors.ingredients}</Small> : null}

        {pickerOpen ? (
          <View style={styles.pickerPanel}>
            <Body style={styles.pickerTitle}>{bs.pickIngredientTitle}</Body>
            {pickable.length > SEARCH_ABOVE_ITEMS ? (
              <TextField
                label={bs.searchPlaceholder}
                value={search}
                onChangeText={setSearch}
                placeholder={bs.searchPlaceholder}
                left={<Icon name="search" size={16} colour={colours.muted} />}
              />
            ) : null}
            <View style={styles.chipRow}>
              {filtered.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => addRow(item)}
                  style={styles.chip}
                >
                  <Small style={styles.chipText}>{item.name}</Small>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setPickerOpen(true)}
            style={styles.addButton}
          >
            <Small style={styles.addButtonText}>{bs.addIngredient}</Small>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  sectionLabel: {
    fontFamily: fonts.bodyExtraBold,
  },
  introText: {
    color: colours.muted,
  },
  row: {
    gap: spacing.xs,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowName: {
    fontFamily: fonts.bodyExtraBold,
  },
  removeButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.pill,
    backgroundColor: colours.card,
  },
  chipText: {
    color: colours.text,
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
  addButton: {
    alignSelf: 'flex-start',
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  addButtonText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
  errorText: {
    color: colours.danger,
    fontFamily: fonts.bodyExtraBold,
  },
});
