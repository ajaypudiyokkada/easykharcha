import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { colours, fonts, radii, spacing, type } from '../theme/tokens';
import { CONTROL_HEIGHT } from '../ui/constants';
import { Small } from '../ui/Text';
import { TextField } from '../ui/TextField';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Latest pickable day (YYYY-MM-DD); later days are blocked in the web date picker. */
  max: string;
  error?: string;
  placeholder?: string;
};

/** A date picker: the browser's own `<input type="date">` on web (the app is web-first, and this
 * gives phones their native calendar), a plain YYYY-MM-DD text field on native. Future days are
 * blocked by `max`; typing past that is still caught by the form's own validation. */
export function DateField({ label, value, onChange, max, error, placeholder }: Props) {
  if (Platform.OS !== 'web') {
    return (
      <TextField
        label={label}
        value={value}
        onChangeText={onChange}
        error={error}
        placeholder={placeholder}
      />
    );
  }
  const inputProps = {
    type: 'date',
    value,
    max,
    'aria-label': label,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    style: {
      width: '100%',
      boxSizing: 'border-box',
      minHeight: CONTROL_HEIGHT,
      padding: `0 ${spacing.md}px`,
      border: `2px solid ${error ? colours.danger : colours.mint}`,
      borderRadius: radii.md,
      background: colours.card,
      color: colours.text,
      fontFamily: fonts.body,
      fontSize: type.md,
    },
  };
  return (
    <View style={styles.wrap}>
      <Small style={styles.label}>{label}</Small>
      {React.createElement('input', inputProps)}
      {error ? <Small style={styles.error}>{error}</Small> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontFamily: fonts.bodyExtraBold, color: colours.text },
  error: { color: colours.danger, fontFamily: fonts.bodyExtraBold },
});
