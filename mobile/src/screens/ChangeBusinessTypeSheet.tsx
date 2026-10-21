import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ItemsSummary } from '../api/client';
import { strings } from '../strings';
import { Body, Button, Icon, Sheet, Small } from '../ui';
import { colours, fonts, radii, spacing } from '../theme/tokens';

const s = strings.app.changeBusinessType;
const PREVIEW_COUNT = 5;

export type ItemsAction = 'keep' | 'remove';

type Props = {
  visible: boolean;
  itemsSummary: ItemsSummary;
  /** The label of the type being switched to, e.g. "Small manufacturing". */
  newTypeLabel: string;
  onCancel: () => void;
  onContinue: (action: ItemsAction) => void;
  continueLoading?: boolean;
};

/** The bottom sheet shown before a business_type change is saved while stock/sell items already
 * exist — asked every time, never silently carried over. Reused by setup/1 (going back to the
 * sector step) and Settings' Business profile. */
export function ChangeBusinessTypeSheet({
  visible,
  itemsSummary,
  newTypeLabel,
  onCancel,
  onContinue,
  continueLoading,
}: Props) {
  const [action, setAction] = useState<ItemsAction>('keep');
  const names = [...itemsSummary.stock_items, ...itemsSummary.sell_items];
  const preview = names.slice(0, PREVIEW_COUNT);
  const more = names.length - preview.length;

  return (
    <Sheet visible={visible} onClose={onCancel} title={s.title(itemsSummary.total_count)}>
      <View style={styles.content}>
        <Body style={styles.body}>{s.body(newTypeLabel)}</Body>

        <View style={styles.names}>
          {preview.map((name) => (
            <Small key={name} style={styles.name}>
              {name}
            </Small>
          ))}
          {more > 0 ? <Small style={styles.more}>{s.moreItems(more)}</Small> : null}
        </View>

        <View style={styles.options}>
          <Option
            label={s.keepOption}
            hint={s.keepHint}
            selected={action === 'keep'}
            onPress={() => setAction('keep')}
          />
          <Option
            label={s.removeOption}
            hint={s.removeHint}
            selected={action === 'remove'}
            onPress={() => setAction('remove')}
          />
        </View>

        <View style={styles.actions}>
          <Button
            label={s.continueButton}
            variant="primary"
            onPress={() => onContinue(action)}
            loading={continueLoading}
          />
          <Button label={s.cancelButton} variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Sheet>
  );
}

function Option({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.option, selected ? styles.optionSelected : null]}
    >
      <View style={styles.optionCopy}>
        <Body style={selected ? styles.optionLabelSelected : styles.optionLabel}>{label}</Body>
        <Small style={styles.optionHint}>{hint}</Small>
      </View>
      {selected ? <Icon name="success" size={18} colour={colours.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
  },
  body: {
    color: colours.muted,
  },
  names: {
    gap: 2,
  },
  name: {
    color: colours.text,
  },
  more: {
    color: colours.muted,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colours.card,
  },
  optionSelected: {
    borderColor: colours.primary,
    backgroundColor: colours.mint,
  },
  optionCopy: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    color: colours.text,
  },
  optionLabelSelected: {
    fontFamily: fonts.bodyExtraBold,
    color: colours.text,
  },
  optionHint: {
    color: colours.muted,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
