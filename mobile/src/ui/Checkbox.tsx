import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colours, fonts, radii, spacing, type } from '../theme/tokens';
import { Icon } from './Icon';
import { Body, Muted } from './Text';

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  /** The kit's two-line label: a bold title plus a small muted explanation underneath. */
  helpText?: string;
  /** Overrides the default `title`/`helpText`-derived accessibility label — for a row where the
   * visible name already lives in an adjacent field (e.g. the menu-scan review list), so `title`
   * can stay blank without leaving the checkbox unlabelled for a screen reader. */
  accessibilityLabel?: string;
};

const BOX_SIZE = 24; // `.check-row input{width:24px;height:24px}` in the kit — the visual box, not the tap area.

/** `.check-row` in the kit: a two-line label, with the whole row tappable at 48px minimum,
 * even though the visual box itself is smaller. */
export function Checkbox({ checked, onChange, title, helpText, accessibilityLabel }: Props) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel ?? (helpText ? `${title}. ${helpText}` : title)}
      onPress={() => onChange(!checked)}
      style={styles.row}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? <Icon name="success" size={16} colour={colours.card} strokeWidth={3} /> : null}
      </View>
      <View style={styles.copy}>
        <Body style={styles.title}>{title}</Body>
        {helpText ? <Muted size="sm">{helpText}</Muted> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: spacing.huge,
  },
  box: {
    width: BOX_SIZE,
    height: BOX_SIZE,
    marginTop: 2,
    borderRadius: radii.sm / 2,
    borderWidth: 2,
    borderColor: colours.mint,
    backgroundColor: colours.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: {
    backgroundColor: colours.primary,
    borderColor: colours.primary,
  },
  copy: {
    flex: 1,
  },
  title: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: type.md,
  },
});
