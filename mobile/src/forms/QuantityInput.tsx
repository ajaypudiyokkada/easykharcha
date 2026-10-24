import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colours, fonts, radii, spacing } from '../theme/tokens';
import { Small, TextField } from '../ui';
import { MAJOR_UNIT_FOR_FAMILY, type UnitStockItem, entryUnitsFor } from '../units';

/** The item's sensibly-chosen default entry unit: kg/L for a weight/volume item (most purchase,
 * count and wastage amounts are bulk, bought/measured by the kg or L), its own unit otherwise
 * (pieces, pack, dozen, ... have no major-unit roll-up). Recipe-ingredient amounts are small
 * (grams/ml per portion), so DishRecipeForm passes `preference="base"` to default to the item's own
 * stored unit instead. */
export function defaultEntryUnit(
  stockItem: UnitStockItem,
  preference: 'major' | 'base' = 'major',
): string {
  if (preference === 'major') {
    const major = MAJOR_UNIT_FOR_FAMILY[stockItem.unit_family];
    if (major) return major;
  }
  return stockItem.unit;
}

type Props = {
  label: string;
  quantity: string;
  onQuantityChange: (text: string) => void;
  /** null/'' means "the item's own base unit". */
  entryUnit: string | null;
  onEntryUnitChange: (unit: string) => void;
  stockItem: UnitStockItem;
  error?: string;
  missingPackSizeHint?: string;
};

/**
 * Step U1b-3a: the shared quantity-entry control for purchases, stock counts, wastage and dish
 * ingredients — a number field plus a row of unit chips built from `entryUnitsFor` (the item's own
 * unit, its kg/L/tonne alias if it has one, and its packet/bag/tin/bottle/box choices once a pack
 * size is set). Sends whichever unit is picked as `entry_unit`; the API converts it down to the
 * item's stored base unit.
 */
export function QuantityInput({
  label,
  quantity,
  onQuantityChange,
  entryUnit,
  onEntryUnitChange,
  stockItem,
  error,
  missingPackSizeHint,
}: Props) {
  const units = Object.keys(entryUnitsFor(stockItem)).sort();
  const selected = entryUnit || stockItem.unit;
  const showPackSizePrompt =
    missingPackSizeHint &&
    MAJOR_UNIT_FOR_FAMILY[stockItem.unit_family] !== undefined &&
    !stockItem.pack_size_base_qty;

  return (
    <View style={styles.wrap}>
      <TextField
        label={label}
        value={quantity}
        onChangeText={onQuantityChange}
        keyboardType="decimal-pad"
        error={error}
      />
      {units.length > 1 ? (
        <View style={styles.chips}>
          {units.map((unit) => {
            const isSelected = unit === selected;
            return (
              <Pressable
                key={unit}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                onPress={() => onEntryUnitChange(unit)}
                style={[styles.chip, isSelected ? styles.chipSelected : null]}
              >
                <Small style={isSelected ? styles.chipTextSelected : styles.chipText}>{unit}</Small>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {showPackSizePrompt ? <Small style={styles.hint}>{missingPackSizeHint}</Small> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
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
  hint: {
    color: colours.muted,
  },
});
