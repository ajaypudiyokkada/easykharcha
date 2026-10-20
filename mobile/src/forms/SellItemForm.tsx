import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type TextInput } from 'react-native';

import type { SellItem, StockItem } from '../api/stock';
import { strings } from '../strings';
import { Banner, Body, Button, Icon, Small, TextField, Toggle } from '../ui';
import { MIN_TOUCH_TARGET } from '../ui/constants';
import { colours, fonts, radii, spacing } from '../theme/tokens';
import { groupItems } from './groupItems';
import { EMPTY_STOCK_ITEM_DRAFT, StockItemForm, type StockItemDraft } from './StockItemForm';

const s3 = strings.setup.step3;
const s4 = strings.setup.step4;
const ss = strings.settings.sell;

export type SellItemDraft = {
  name: string;
  sellingPrice: string;
  mainStockItemId: number | null;
  usesQty: string;
  group: string;
  active: boolean;
};

export const EMPTY_SELL_ITEM_DRAFT: SellItemDraft = {
  name: '',
  sellingPrice: '',
  mainStockItemId: null,
  usesQty: '',
  group: '',
  active: true,
};

export function sellItemToDraft(item: SellItem): SellItemDraft {
  return {
    name: item.name,
    sellingPrice: item.selling_price,
    mainStockItemId: item.main_stock_item,
    usesQty: item.uses_qty ?? '',
    group: item.group,
    active: item.active,
  };
}

type Props = {
  value: SellItemDraft;
  onChange: (patch: Partial<SellItemDraft>) => void;
  errors?: { name?: string; price?: string; usesQty?: string };
  /** Linkable (non-shared) stock items — null while still loading. */
  stockItems: StockItem[] | null;
  /** Saves one new stock item (the picker's "+ Add a new item") and returns it — the caller owns
   * the actual request, since this form has no fetch access of its own. */
  onAddStockItem: (draft: StockItemDraft) => Promise<StockItem>;
  /** Settings' add/edit sheet shows "How much does one use?" once a main stock item is chosen; the
   * wizard's "add your own" form never does — uses_qty isn't part of that step's spec. */
  showUsesQty?: boolean;
  /** Settings' edit sheet shows this; the wizard's "add your own" form never does. */
  showActive?: boolean;
  existingGroups?: string[];
  nameFieldRef?: React.Ref<TextInput>;
};

const SEARCH_ABOVE_ITEMS = 6;

/** The sell-item fields shared by setup/4's "Add your own" and Settings' "What you sell" add/edit
 * sheet — name, price, main stock item (a searchable, grouped picker with an inline "add a new
 * stock item" escape hatch — Step 19), "how much does one use", group, and optionally active. No
 * Save/Add button here — the caller owns that. */
export function SellItemForm({
  value,
  onChange,
  errors,
  stockItems,
  onAddStockItem,
  showUsesQty,
  showActive,
  existingGroups,
  nameFieldRef,
}: Props) {
  const [search, setSearch] = useState('');
  const [addingStockItem, setAddingStockItem] = useState(false);
  const [newItemDraft, setNewItemDraft] = useState<StockItemDraft>(EMPTY_STOCK_ITEM_DRAFT);
  const [newItemFieldErrors, setNewItemFieldErrors] = useState<{ name?: string; unit?: string }>(
    {},
  );
  const [newItemError, setNewItemError] = useState<string | null>(null);
  const [savingNewItem, setSavingNewItem] = useState(false);

  const selectedItem = stockItems?.find((item) => item.id === value.mainStockItemId) ?? null;

  const filtered = useMemo(() => {
    if (!stockItems) return [];
    const key = search.trim().toLowerCase();
    return key ? stockItems.filter((item) => item.name.toLowerCase().includes(key)) : stockItems;
  }, [stockItems, search]);
  const grouped = useMemo(() => groupItems(filtered), [filtered]);

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
      onChange({ mainStockItemId: created.id });
      setAddingStockItem(false);
      setNewItemDraft(EMPTY_STOCK_ITEM_DRAFT);
      setNewItemFieldErrors({});
    } catch {
      setNewItemError(s4.errors.generic);
    } finally {
      setSavingNewItem(false);
    }
  }

  return (
    <View style={styles.field}>
      <TextField
        ref={nameFieldRef}
        label={s4.nameLabel}
        value={value.name}
        onChangeText={(name) => onChange({ name })}
        placeholder={s4.namePlaceholder}
        maxLength={120}
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
        <Small style={styles.introText}>{s4.usesPickerIntro}</Small>

        {stockItems === null ? (
          <ActivityIndicator color={colours.primary} />
        ) : (
          <>
            {stockItems.length > SEARCH_ABOVE_ITEMS ? (
              <TextField
                label={s4.searchStockItems}
                value={search}
                onChangeText={setSearch}
                placeholder={s4.searchStockItems}
                left={<Icon name="search" size={16} colour={colours.muted} />}
              />
            ) : null}

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
                    value.mainStockItemId === null
                      ? styles.unitChipTextSelected
                      : styles.unitChipText
                  }
                >
                  {s4.noMainStockItem}
                </Small>
              </Pressable>
            </View>

            {grouped.map(({ group, items }) => (
              <View key={group} style={styles.groupBlock}>
                {grouped.length > 1 ? <Small style={styles.groupLabel}>{group}</Small> : null}
                <View style={styles.unitRow}>
                  {items.map((item) => {
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
              </View>
            ))}

            {stockItems.length === 0 ? (
              <Small style={styles.introText}>{s4.noStockItemsYet}</Small>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={() => setAddingStockItem((current) => !current)}
              style={styles.addNewButton}
            >
              <Small style={styles.addNewButtonText}>{s4.addNewStockItem}</Small>
            </Pressable>

            {addingStockItem ? (
              <View style={styles.addNewPanel}>
                <Body style={styles.addNewTitle}>{s4.addNewStockItemTitle}</Body>
                {newItemError ? <Banner kind="error">{newItemError}</Banner> : null}
                <StockItemForm
                  value={newItemDraft}
                  onChange={(patch) => setNewItemDraft((current) => ({ ...current, ...patch }))}
                  errors={newItemFieldErrors}
                />
                <Button
                  label={s3.addItem}
                  variant="primary"
                  onPress={handleAddStockItem}
                  loading={savingNewItem}
                />
              </View>
            ) : null}
          </>
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
          error={errors?.usesQty}
        />
      ) : null}

      <View style={styles.field}>
        <TextField
          label={s4.groupLabel}
          value={value.group}
          onChangeText={(group) => onChange({ group })}
          placeholder={s4.groupPlaceholder}
          maxLength={40}
        />
        {existingGroups && existingGroups.length > 0 ? (
          <View style={styles.unitRow}>
            {existingGroups
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
        ) : null}
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
  introText: {
    color: colours.muted,
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
});
