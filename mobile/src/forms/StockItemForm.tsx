import React, { useState } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';

import type { StockItem } from '../api/stock';
import { UNITS, type UnitValue } from '../constants/units';
import { sectorCopyFor } from '../sectorCopy';
import { strings } from '../strings';
import { baseUnitFor, unitFamily } from '../units';
import { Banner, Small, TextField, Toggle } from '../ui';
import { MIN_TOUCH_TARGET } from '../ui/constants';
import { colours, fonts, radii, spacing } from '../theme/tokens';

const s3 = strings.setup.step3;
const ss = strings.settings.stock;

export type StockItemDraft = {
  name: string;
  unit: UnitValue | '';
  /** "1 pack = N base units" (e.g. 500 for "1 packet = 500 g") — set once, never locked. */
  packSizeBaseQty: string;
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
  packSizeBaseQty: '',
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
    packSizeBaseQty: item.pack_size_base_qty ?? '',
    usualPrice: item.usual_price ?? '',
    supplier: item.supplier,
    shared: item.shared,
    goesOff: item.goes_off,
    shelfLifeDays: item.shelf_life_days != null ? String(item.shelf_life_days) : '',
    group: item.group,
    active: item.active,
  };
}

/** A fresh draft pre-filled with this business type's default unit — used everywhere a brand-new
 * stock item is started (not editing an existing one, which keeps its own unit). */
export function emptyStockItemDraft(businessType: string): StockItemDraft {
  return { ...EMPTY_STOCK_ITEM_DRAFT, unit: sectorCopyFor(businessType).defaultUnit };
}

type Props = {
  value: StockItemDraft;
  onChange: (patch: Partial<StockItemDraft>) => void;
  errors?: {
    name?: string;
    unit?: string;
    usualPrice?: string;
    packSizeBaseQty?: string;
    shelfLifeDays?: string;
  };
  /** Drives every sector-varying placeholder, unit list and toggle wording — see sectorCopy.ts. */
  businessType: string;
  /** True once this item has purchase/count/wastage/sale history — picking a different unit
   * *family* (not just its kg/g/tonne-style alias) would be rejected on save, so this shows a
   * heads-up instead of only an error after the fact. Never set for a brand-new item. */
  unitLocked?: boolean;
  /** Settings' edit sheet shows this; the wizard's "add your own" form never does. */
  showActive?: boolean;
  /** This business's existing stock-item groups (from whatever list the caller already loaded),
   * offered as quick-pick chips alongside the business type's own starter set shown when there are
   * none yet. */
  existingGroups?: string[];
  /** Attached to the name field so a caller (see hooks/useInstantAdd.ts) can refocus it after a
   * successful add, ready for the next item with no extra tap. */
  nameFieldRef?: React.Ref<TextInput>;
  /** Step 20's starter-pack picker "Add your own": name, unit and group only — a catalogue entry
   * has no price/supplier/shared/perishable guess worth asking for up front, so those stay editable
   * later from Stock instead. */
  minimal?: boolean;
};

/** The stock-item fields shared by setup/3's "add your own" and Settings' "What you buy" add/edit
 * sheet — name, unit, usual price, supplier, shared, perishable (+ shelf life), group, and
 * optionally active. No Save/Add button here — the caller owns that, since the two contexts save
 * differently. */
export function StockItemForm({
  value,
  onChange,
  errors,
  businessType,
  unitLocked,
  showActive,
  existingGroups,
  nameFieldRef,
  minimal,
}: Props) {
  const cfg = sectorCopyFor(businessType);
  const [showMoreUnits, setShowMoreUnits] = useState(
    () => !!value.unit && !cfg.allowedUnits.includes(value.unit),
  );
  const [showMoreOptions, setShowMoreOptions] = useState(() => cfg.goesOffDefault || value.goesOff);

  const groupSuggestions =
    existingGroups && existingGroups.length > 0 ? existingGroups : cfg.stockGroupSuggestions;
  const primaryUnits = UNITS.filter((unit) => cfg.allowedUnits.includes(unit.value));
  const moreUnits = UNITS.filter((unit) => !cfg.allowedUnits.includes(unit.value));

  function unitChip(unit: (typeof UNITS)[number]) {
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
  }

  /** Groups a row of unit chips into Weight/Volume/Count sections (src/units.ts's families) so the
   * picker reads as "what kind of thing is this" first, "which label exactly" second — without
   * dropping any unit from the row it's given (sectorCopy.json's lists plus the "More units"
   * fallback already guarantee every Unit choice is reachable). */
  function unitFamilyGroups(units: (typeof UNITS)[number][]) {
    return (['weight', 'volume', 'count'] as const)
      .map((family) => ({
        family,
        units: units.filter((unit) => unitFamily(unit.value) === family),
      }))
      .filter((group) => group.units.length > 0);
  }

  function unitFamilyRows(units: (typeof UNITS)[number][]) {
    return unitFamilyGroups(units).map((group) => (
      <View key={group.family} style={styles.unitFamilyBlock}>
        <Small style={styles.unitFamilyLabel}>{s3.unitFamilyLabels[group.family]}</Small>
        <View style={styles.unitRow}>{group.units.map(unitChip)}</View>
      </View>
    ));
  }

  // Weight/volume items (g/ml base, kg/L/tonne entry aliases) and a count item whose own unit is
  // "bottle" (a pack of pieces with a known size, Decision 5 — U1b-1 report) can set a pack size;
  // any other count label (piece, dozen, box, ...) has no meaningful "1 pack = N" to ask for.
  const canSetPackSize =
    !!value.unit && (unitFamily(value.unit) !== 'count' || value.unit === 'bottle');
  const packSizeUnit =
    value.unit && unitFamily(value.unit) !== 'count' ? baseUnitFor(value.unit) : 'ml';

  return (
    <View style={styles.field}>
      <TextField
        ref={nameFieldRef}
        label={s3.nameLabel}
        value={value.name}
        onChangeText={(name) => onChange({ name })}
        placeholder={cfg.stockNamePlaceholder}
        maxLength={120}
        error={errors?.name}
      />

      <View style={styles.field}>
        <Small style={styles.unitLabel}>{s3.unitLabel}</Small>
        {unitFamilyRows(primaryUnits)}
        {moreUnits.length > 0 ? (
          <>
            {showMoreUnits ? unitFamilyRows(moreUnits) : null}
            <Pressable accessibilityRole="button" onPress={() => setShowMoreUnits((s) => !s)}>
              <Small style={styles.disclosureText}>
                {showMoreUnits ? s3.fewerUnits : s3.moreUnits}
              </Small>
            </Pressable>
          </>
        ) : null}
        {errors?.unit ? <Small style={styles.errorText}>{errors.unit}</Small> : null}
        {unitLocked ? (
          <View style={styles.lockBanner}>
            <Banner kind="info">{s3.unitLockedMessage}</Banner>
          </View>
        ) : null}
      </View>

      {!minimal && canSetPackSize ? (
        <TextField
          label={s3.packSizeLabel(packSizeUnit)}
          value={value.packSizeBaseQty}
          onChangeText={(packSizeBaseQty) => onChange({ packSizeBaseQty })}
          placeholder={s3.packSizePlaceholder}
          keyboardType="decimal-pad"
          error={errors?.packSizeBaseQty}
        />
      ) : null}

      {!minimal ? (
        <>
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
            helpText={cfg.sharedToggleHelp}
            value={value.shared}
            onChange={(shared) => onChange({ shared })}
          />

          {cfg.goesOffDefault ? (
            <>
              <Toggle
                title={cfg.goesOffQuestion}
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
            </>
          ) : (
            <View style={styles.field}>
              <Pressable accessibilityRole="button" onPress={() => setShowMoreOptions((s) => !s)}>
                <Small style={styles.disclosureText}>
                  {showMoreOptions ? s3.fewerOptions : s3.moreOptions}
                </Small>
              </Pressable>
              {showMoreOptions ? (
                <>
                  <Toggle
                    title={cfg.goesOffQuestion}
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
                </>
              ) : null}
            </View>
          )}
        </>
      ) : null}

      <View style={styles.field}>
        <TextField
          label={s3.groupLabel}
          value={value.group}
          onChangeText={(group) => onChange({ group })}
          placeholder={cfg.stockGroupPlaceholder}
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
  unitFamilyBlock: {
    gap: spacing.xs,
  },
  unitFamilyLabel: {
    color: colours.muted,
  },
  lockBanner: {
    marginTop: spacing.xs,
  },
  disclosureText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
    minHeight: MIN_TOUCH_TARGET,
    textAlignVertical: 'center',
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
