import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { SellItem, StockItem } from '../api/stock';
import { strings } from '../strings';
import { Muted, Small, TextField, Toggle } from '../ui';
import { MIN_TOUCH_TARGET } from '../ui/constants';
import { colours, fonts, radii, spacing } from '../theme/tokens';

const s4 = strings.setup.step4;
const ss = strings.settings.sell;

export type SellItemDraft = {
  name: string;
  sellingPrice: string;
  mainStockItemId: number | null;
  usesQty: string;
  active: boolean;
};

export const EMPTY_SELL_ITEM_DRAFT: SellItemDraft = {
  name: '',
  sellingPrice: '',
  mainStockItemId: null,
  usesQty: '',
  active: true,
};

export function sellItemToDraft(item: SellItem): SellItemDraft {
  return {
    name: item.name,
    sellingPrice: item.selling_price,
    mainStockItemId: item.main_stock_item,
    usesQty: item.uses_qty ?? '',
    active: item.active,
  };
}

type Props = {
  value: SellItemDraft;
  onChange: (patch: Partial<SellItemDraft>) => void;
  errors?: { name?: string; price?: string };
  /** Linkable (non-shared) stock items — null while still loading. */
  stockItems: StockItem[] | null;
  /** Settings' add/edit sheet shows "How much does one use?" once a main stock item is chosen; the
   * wizard's "add your own" form never does — uses_qty isn't part of that step's spec. */
  showUsesQty?: boolean;
  /** Settings' edit sheet shows this; the wizard's "add your own" form never does. */
  showActive?: boolean;
};

/** The sell-item fields shared by setup/4's "Add your own" and Settings' "What you sell" add/edit
 * sheet — name, price, main stock item, "how much does one use", and optionally active. No Save/Add
 * button here — the caller owns that. */
export function SellItemForm({
  value,
  onChange,
  errors,
  stockItems,
  showUsesQty,
  showActive,
}: Props) {
  const selectedItem = stockItems?.find((item) => item.id === value.mainStockItemId) ?? null;

  return (
    <View style={styles.field}>
      <TextField
        label={s4.nameLabel}
        value={value.name}
        onChangeText={(name) => onChange({ name })}
        placeholder={s4.namePlaceholder}
        error={errors?.name}
      />

      <TextField
        label={s4.priceLabel}
        value={value.sellingPrice}
        onChangeText={(sellingPrice) => onChange({ sellingPrice })}
        placeholder={s4.pricePlaceholder}
        keyboardType="decimal-pad"
        error={errors?.price}
      />

      <View style={styles.field}>
        <Small style={styles.unitLabel}>{s4.mainStockItemLabel}</Small>
        {stockItems === null ? (
          <ActivityIndicator color={colours.primary} />
        ) : stockItems.length === 0 ? (
          <Muted size="sm">{s4.noStockItemsYet}</Muted>
        ) : (
          <View style={styles.unitRow}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: value.mainStockItemId === null }}
              onPress={() => onChange({ mainStockItemId: null, usesQty: '' })}
              style={[
                styles.unitChip,
                value.mainStockItemId === null ? styles.unitChipSelected : null,
              ]}
            >
              <Small
                style={
                  value.mainStockItemId === null ? styles.unitChipTextSelected : styles.unitChipText
                }
              >
                {s4.noMainStockItem}
              </Small>
            </Pressable>
            {stockItems.map((item) => {
              const selected = value.mainStockItemId === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => onChange({ mainStockItemId: item.id })}
                  style={[styles.unitChip, selected ? styles.unitChipSelected : null]}
                >
                  <Small style={selected ? styles.unitChipTextSelected : styles.unitChipText}>
                    {item.name}
                  </Small>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {showUsesQty && selectedItem ? (
        <TextField
          label={`${ss.usesQtyLabel} (${selectedItem.unit})`}
          value={value.usesQty}
          onChangeText={(usesQty) => onChange({ usesQty })}
          placeholder="0.000"
          keyboardType="decimal-pad"
          hint={ss.usesQtyHelp}
        />
      ) : null}

      {showActive ? (
        <Toggle
          title={ss.activeToggle}
          value={value.active}
          onChange={(active) => onChange({ active })}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  unitLabel: {
    fontFamily: fonts.bodyExtraBold,
  },
  unitRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
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
});
