import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { StarterPackStockItem } from '../api/stock';
import { findDuplicateName, groupItems } from '../forms/groupItems';
import { EMPTY_STOCK_ITEM_DRAFT, StockItemForm, type StockItemDraft } from '../forms/StockItemForm';
import { strings } from '../strings';
import { Banner, Checkbox, GroupedList, Icon, Small, TextField } from '../ui';
import { MIN_TOUCH_TARGET } from '../ui/constants';
import { colours, fonts, radii, spacing } from '../theme/tokens';

const sp = strings.starterPicker;

export type StarterCustomItem = { name: string; unit: string; group: string };

export type StarterPickerValue = {
  /** Catalogue item names (exact casing from the catalogue) the owner has ticked. */
  ticked: Set<string>;
  /** Items typed in via "Can't find it? Add your own" — not on the catalogue at all. */
  custom: StarterCustomItem[];
};

export const EMPTY_STARTER_PICKER_VALUE: StarterPickerValue = { ticked: new Set(), custom: [] };

/** JSON-serialisable twin of StarterPickerValue, for itemDraftStorage (a Set doesn't survive
 * JSON.stringify). */
export type StarterPickerDraft = { ticked: string[]; custom: StarterCustomItem[] };

export function toStarterPickerDraft(value: StarterPickerValue): StarterPickerDraft {
  return { ticked: [...value.ticked], custom: value.custom };
}

export function fromStarterPickerDraft(
  draft: StarterPickerDraft | null | undefined,
): StarterPickerValue {
  if (!draft) return EMPTY_STARTER_PICKER_VALUE;
  return { ticked: new Set(draft.ticked), custom: draft.custom };
}

export function starterPickerCount(value: StarterPickerValue): number {
  return value.ticked.size + value.custom.length;
}

/** One bulk-create payload for everything ticked/added in the picker — `skip_existing: true` makes
 * repeating this call (back/forward in setup, reopening "Add from starter list") harmless. */
export function buildStarterBulkPayload(
  catalogue: StarterPackStockItem[],
  value: StarterPickerValue,
) {
  const ticked = catalogue
    .filter((item) => value.ticked.has(item.name))
    .map((item) => ({
      name: item.name,
      unit: item.unit,
      group: item.group || undefined,
      goes_off: item.goes_off || undefined,
      shelf_life_days: item.goes_off && item.shelf_life_days ? item.shelf_life_days : undefined,
    }));
  const custom = value.custom.map((item) => ({
    name: item.name,
    unit: item.unit,
    group: item.group || undefined,
  }));
  return { items: [...ticked, ...custom], skip_existing: true };
}

type Props = {
  catalogue: StarterPackStockItem[];
  /** This business's current stock items — ticked/added items already there are hidden. */
  existingItems: { name: string }[];
  value: StarterPickerValue;
  onChange: (value: StarterPickerValue) => void;
};

/**
 * Step 20: "What do you keep in stock?" — groups as collapsible sections with a per-group
 * "N of M" count and "Select all", a search box across all groups, and a "Can't find it? Add your
 * own" quick add. Nothing here saves on its own — the caller turns `value` into one bulk-create
 * request (see buildStarterBulkPayload) on its own Continue/Next action.
 */
export function StarterStockPicker({ catalogue, existingItems, value, onChange }: Props) {
  const [search, setSearch] = useState('');
  const [addDraft, setAddDraft] = useState<StockItemDraft>(EMPTY_STOCK_ITEM_DRAFT);
  const [addError, setAddError] = useState<string | null>(null);

  const alreadyAdded = new Set(existingItems.map((item) => item.name.toLowerCase()));
  const available = catalogue.filter((item) => !alreadyAdded.has(item.name.toLowerCase()));
  const term = search.trim().toLowerCase();
  const filtered = term
    ? available.filter((item) => item.name.toLowerCase().includes(term))
    : available;
  const groups = groupItems(filtered);
  const existingGroups = [...new Set(available.map((item) => item.group).filter(Boolean))];

  function toggle(item: StarterPackStockItem) {
    const next = new Set(value.ticked);
    if (next.has(item.name)) next.delete(item.name);
    else next.add(item.name);
    onChange({ ...value, ticked: next });
  }

  function toggleGroup(items: StarterPackStockItem[]) {
    const allSelected = items.every((item) => value.ticked.has(item.name));
    const next = new Set(value.ticked);
    for (const item of items) {
      if (allSelected) next.delete(item.name);
      else next.add(item.name);
    }
    onChange({ ...value, ticked: next });
  }

  function removeCustom(name: string) {
    onChange({ ...value, custom: value.custom.filter((item) => item.name !== name) });
  }

  function handleAddCustom() {
    const name = addDraft.name.trim();
    if (!name) {
      setAddError(sp.errors.nameRequired);
      return;
    }
    if (name.length > 120) {
      setAddError(sp.errors.nameTooLong);
      return;
    }
    if (!addDraft.unit) {
      setAddError(sp.errors.unitRequired);
      return;
    }
    const dup = findDuplicateName([...existingItems, ...value.custom, ...available], name);
    if (dup) {
      setAddError(sp.errors.duplicateName(dup.name));
      return;
    }
    onChange({
      ...value,
      custom: [...value.custom, { name, unit: addDraft.unit, group: addDraft.group.trim() }],
    });
    setAddDraft(EMPTY_STOCK_ITEM_DRAFT);
    setAddError(null);
  }

  return (
    <View style={styles.wrap}>
      <TextField
        label={sp.searchLabel}
        value={search}
        onChangeText={setSearch}
        placeholder={sp.searchPlaceholder}
      />

      {groups.length === 0 ? (
        <Small style={styles.emptyText}>{term ? sp.noMatches : sp.allAdded}</Small>
      ) : (
        <GroupedList
          groups={groups}
          getKey={(item) => item.name}
          countLabel={(_group, items) =>
            sp.selectedOf(items.filter((item) => value.ticked.has(item.name)).length, items.length)
          }
          headerAccessory={(_group, items) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => toggleGroup(items)}
              hitSlop={8}
              style={styles.selectAllHit}
            >
              <Small style={styles.selectAllText}>
                {items.every((item) => value.ticked.has(item.name)) ? sp.clearAll : sp.selectAll}
              </Small>
            </Pressable>
          )}
          renderItem={(item) => (
            <Checkbox
              checked={value.ticked.has(item.name)}
              onChange={() => toggle(item)}
              title={item.name}
              helpText={item.unit}
            />
          )}
        />
      )}

      {value.custom.length > 0 ? (
        <View style={styles.customSection}>
          <Small style={styles.sectionLabel}>{sp.addedByYou}</Small>
          {value.custom.map((item) => (
            <View key={item.name} style={styles.customRow}>
              <View style={styles.customRowCopy}>
                <Small style={styles.customRowName}>{item.name}</Small>
                <Small style={styles.customRowMeta}>{item.unit}</Small>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${sp.addedByYou} ${item.name}`}
                onPress={() => removeCustom(item.name)}
                style={styles.customRowAction}
              >
                <Icon name="delete" size={18} colour={colours.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.addOwn}>
        <Small style={styles.sectionLabel}>{sp.addOwn}</Small>
        {addError ? <Banner kind="error">{addError}</Banner> : null}
        <StockItemForm
          value={addDraft}
          onChange={(patch) => setAddDraft((current) => ({ ...current, ...patch }))}
          existingGroups={existingGroups}
          minimal
        />
        <Pressable accessibilityRole="button" onPress={handleAddCustom} style={styles.addButton}>
          <Small style={styles.addButtonText}>{sp.addItem}</Small>
        </Pressable>
      </View>

      <Small style={styles.selectedCount}>{sp.selectedCount(starterPickerCount(value))}</Small>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  emptyText: {
    color: colours.muted,
  },
  sectionLabel: {
    fontFamily: fonts.bodyExtraBold,
  },
  selectAllHit: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  selectAllText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
  customSection: {
    gap: spacing.sm,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  customRowCopy: {
    flex: 1,
    gap: 2,
  },
  customRowName: {
    fontFamily: fonts.bodyExtraBold,
  },
  customRowMeta: {
    color: colours.muted,
  },
  customRowAction: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addOwn: {
    gap: spacing.sm,
  },
  addButton: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.primary,
    borderRadius: radii.pill,
  },
  addButtonText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
  selectedCount: {
    color: colours.muted,
    fontFamily: fonts.bodyExtraBold,
  },
});
