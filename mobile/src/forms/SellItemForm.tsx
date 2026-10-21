import React from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';

import { sectorCopyFor } from '../sectorCopy';
import { strings } from '../strings';
import { Small, TextField } from '../ui';
import { MIN_TOUCH_TARGET } from '../ui/constants';
import { colours, radii, spacing } from '../theme/tokens';

const s4 = strings.setup.step4;
const sd = strings.dishForm;

export type SellItemDraft = {
  name: string;
  sellingPrice: string;
  portionLabel: string;
  group: string;
};

export const EMPTY_SELL_ITEM_DRAFT: SellItemDraft = {
  name: '',
  sellingPrice: '',
  portionLabel: '',
  group: '',
};

type Props = {
  value: SellItemDraft;
  onChange: (patch: Partial<SellItemDraft>) => void;
  errors?: { name?: string; price?: string };
  /** Drives every sector-varying placeholder and wording — see sectorCopy.ts. */
  businessType: string;
  existingGroups?: string[];
  nameFieldRef?: React.Ref<TextInput>;
};

/**
 * The quick, no-ingredients sell-item fields shared by setup/4's "Add your own" and Settings'
 * "What you sell" quick-add box — name, price, portion label and group. Step 22a: this always
 * creates a dish with recipe_status=none; attaching ingredients is the manual dish form's job
 * instead (Settings' "Add a dish", see DishRecipeForm.tsx), reachable afterward via the "needs
 * ingredients" badge/checklist. Create-only — editing a dish always goes through the full dish form,
 * so there's no showActive/edit mode here. No Save/Add button here — the caller owns that.
 */
export function SellItemForm({
  value,
  onChange,
  errors,
  businessType,
  existingGroups,
  nameFieldRef,
}: Props) {
  const cfg = sectorCopyFor(businessType);

  return (
    <View style={styles.field}>
      <TextField
        ref={nameFieldRef}
        label={s4.nameLabel}
        value={value.name}
        onChangeText={(name) => onChange({ name })}
        placeholder={cfg.sellNamePlaceholder}
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

      <TextField
        label={sd.portionLabel}
        value={value.portionLabel}
        onChangeText={(portionLabel) => onChange({ portionLabel })}
        placeholder={cfg.sellPortionPlaceholder}
        maxLength={40}
      />

      <View style={styles.field}>
        <TextField
          label={s4.groupLabel}
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
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  unitRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
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
});
