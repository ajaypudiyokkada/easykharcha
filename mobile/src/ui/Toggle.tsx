import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { colours, fonts, spacing, type } from '../theme/tokens';
import { Body, Muted } from './Text';

type Props = {
  value: boolean;
  onChange: (value: boolean) => void;
  title: string;
  helpText?: string;
};

/**
 * Not in the Step 2 kit — added for "Used in many items" and "Goes off", which are genuinely
 * on/off settings rather than a confirm-this-sentence checkbox. Uses React Native's own `Switch`
 * (a real native control on iOS/Android, a styled checkbox-like toggle on web) rather than
 * reinventing one, with the same two-line label pattern as `Checkbox`.
 */
export function Toggle({ value, onChange, title, helpText }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Body style={styles.title}>{title}</Body>
        {helpText ? <Muted size="sm">{helpText}</Muted> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colours.mint, true: colours.primary }}
        thumbColor={colours.card}
        accessibilityLabel={title}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: spacing.huge,
  },
  copy: {
    flex: 1,
  },
  title: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: type.md,
  },
});
