import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colours, fonts, radii, spacing } from '../theme/tokens';
import { CONTROL_HEIGHT } from './constants';
import { Small } from './Text';
import { TextField, type TextFieldProps } from './TextField';

export type PasswordStrength = 'weak' | 'okay' | 'strong';

const STRENGTH_WORD: Record<PasswordStrength, string> = {
  weak: 'Weak',
  okay: 'Okay',
  strong: 'Strong',
};

/** Same rule as the kit's own script: length and character variety, not a password-strength library. */
export function computeStrength(value: string): PasswordStrength {
  if (value.length >= 10 && /[A-Z]/.test(value) && /[0-9]/.test(value)) return 'strong';
  if (value.length >= 8) return 'okay';
  return 'weak';
}

type Props = Omit<TextFieldProps, 'right' | 'left' | 'secureTextEntry'>;

/** §4 in the kit: a `TextField` with a Show/Hide toggle and a three-bar strength meter + word —
 * strength is never colour alone, the word is always shown too. */
export function PasswordField({ value, ...rest }: Props) {
  const [visible, setVisible] = useState(false);
  const strength = computeStrength(value);
  const showMeter = value.length > 0;

  return (
    <View style={styles.wrapper}>
      <TextField
        {...rest}
        value={value}
        secureTextEntry={!visible}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            onPress={() => setVisible((current) => !current)}
            style={styles.toggle}
          >
            <Small style={styles.toggleText}>{visible ? 'Hide' : 'Show'}</Small>
          </Pressable>
        }
      />

      {showMeter ? (
        <View accessibilityLiveRegion="polite">
          <View
            style={styles.bars}
            accessibilityRole="progressbar"
            accessibilityLabel="Password strength"
            accessibilityValue={{ text: STRENGTH_WORD[strength] }}
          >
            {[0, 1, 2].map((index) => (
              <View key={index} style={[styles.bar, barStyle(strength, index)]} />
            ))}
          </View>
          <Small style={styles.word}>{STRENGTH_WORD[strength]}</Small>
        </View>
      ) : null}
    </View>
  );
}

function barStyle(strength: PasswordStrength, index: number) {
  // `.strength.weak span:nth-child(1)`, `.okay span:nth-child(-n+2)`, `.strong span` (all three).
  const litCount = strength === 'weak' ? 1 : strength === 'okay' ? 2 : 3;
  const colour =
    strength === 'weak' ? colours.danger : strength === 'okay' ? colours.warning : colours.success;
  return { backgroundColor: index < litCount ? colour : colours.mint };
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.sm,
  },
  toggle: {
    minWidth: spacing.huge + spacing.xl,
    minHeight: CONTROL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  toggleText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
  bars: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bar: {
    flex: 1,
    height: spacing.sm,
    borderRadius: radii.pill,
  },
  word: {
    marginTop: spacing.xs,
    fontFamily: fonts.bodyExtraBold,
    color: colours.text,
  },
});
