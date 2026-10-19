import React from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';

import type { StockItem } from '../api/stock';
import { UNITS, type UnitValue } from '../constants/units';
import { strings } from '../strings';
import { Small, TextField, Toggle } from '../ui';
import { MIN_TOUCH_TARGET } from '../ui/constants';
import { colours, fonts, radii, spacing } from '../theme/tokens';

const s3 = strings.setup.step3;
const ss = strings.settings.stock;

export type StockItemDraft = {
  name: string;
  unit: UnitValue | '';
  usualPrice: string;
  supplier: string;
  shared: boolean;
  goesOff: boolean;
  shelfLifeDays: string;
  group: string;
  active: boolean;
};

export const EMPTY_STOCK_ITEM_DRAFT: StockItemDraft = {
  name: '',
  unit: '',
  usualPrice: '',
  supplier: '',
  shared: false,
  goesOff: false,
  shelfLifeDays: '',
  group: '',
  active: true,
};

export function stockItemToDraft(item: StockItem): StockItemDraft {
  return {
    name: item.name,
    unit: item.unit as UnitValue,
    usualPrice: item.usual_price ?? '',
    supplier: item.supplier,
    shared: item.shared,
    goesOff: item.goes_off,
    shelfLifeDays: item.shelf_life_days != null ? String(item.shelf_life_days) : '',
    group: item.group,
    active: item.active,
  };
}

type Props = {
  value: StockItemDraft;
  onChange: (patch: Partial<StockItemDraft>) => void;
  errors?: { name?: string; unit?: string; usualPrice?: string; shelfLifeDays?: string };
  /** Settings' edit sheet shows this; the wizard's "add your own" form never does. */
  showActive?: boolean;
  /** This business's existing stock-item groups (from whatever list the caller already loaded),
   * offered as quick-pick chips alongside the fixed starter set shown when there are none yet. */
  existingGroups?: string[];
  /** Attached to the name field so a caller (see hooks/useInstantAdd.ts) can refocus it after a
   * successful add, ready for the next item with no extra tap. */
  nameFieldRef?: React.Ref<TextInput>;
};

/** The stock-item fields shared by setup/3's "add your own" and Settings' "What you buy" add/edit
 * sheet — name, unit, usual price, supplier, shared, goes off (+ shelf life), group, and
 * optionally active. No Save/Add button here — the caller owns that, since the two contexts save
 * differently. */
export function StockItemForm({
  value,
  onChange,
  errors,
  showActive,
  existingGroups,
  nameFieldRef,
}: Props) {
  const groupSuggestions =
    existingGroups && existingGroups.length > 0 ? existingGroups : s3.groupSuggestions;

  return (
    <View style={styles.field}>
      <TextField
        ref={nameFieldRef}
        label={s3.nameLabel}
        value={value.name}
        onChangeText={(name) => onChange({ name })}
        placeholder={s3.namePlaceholder}
        maxLength={120}
        error={errors?.name}
      />

      <View style={styles.field}>
        <Small style={styles.unitLabel}>{s3.unitLabel}</Small>
        <View style={styles.unitRow}>
          {UNITS.map((unit) => {
            const selected = value.unit === unit.value;
            return (
              <Pressable
                key={unit.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => onChange({ unit: unit.value })}
                style={[styles.unitChip, selected ? styles.unitChipSelected : null]}
              >
                <Small style={selected ? styles.unitChipTextSelected : styles.unitChipText}>
                  {unit.label}
                </Small>
              </Pressable>
            );
          })}
        </View>
        {errors?.unit ? <Small style={styles.errorText}>{errors.unit}</Small> : null}
      </View>

      <TextField
        label={s3.priceLabel}
        value={value.usualPrice}
        onChangeText={(usualPrice) => onChange({ usualPrice })}
        placeholder={s3.pricePlaceholder}
        keyboardType="decimal-pad"
        error={errors?.usualPrice}
      />

      <TextField
        label={s3.supplierLabel}
        value={value.supplier}
        onChangeText={(supplier) => onChange({ supplier })}
        placeholder={s3.supplierPlaceholder}
      />

      <Toggle
        title={s3.sharedToggle}
        value={value.shared}
        onChange={(shared) => onChange({ shared })}
      />

      <Toggle
        title={s3.goesOffToggle}
        value={value.goesOff}
        onChange={(goesOff) => onChange({ goesOff })}
      />

      {value.goesOff ? (
        <TextField
          label={s3.shelfLifeLabel}
          value={value.shelfLifeDays}
          onChangeText={(shelfLifeDays) => onChange({ shelfLifeDays })}
          placeholder={s3.shelfLifePlaceholder}
          keyboardType="number-pad"
          error={errors?.shelfLifeDays}
        />
      ) : null}

      <View style={styles.field}>
        <TextField
          label={s3.groupLabel}
          value={value.group}
          onChangeText={(group) => onChange({ group })}
          placeholder={s3.groupPlaceholder}
          maxLength={40}
        />
        <View style={styles.unitRow}>
          {groupSuggestions
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
  errorText: {
    color: colours.danger,
    fontFamily: fonts.bodyExtraBold,
  },
});
