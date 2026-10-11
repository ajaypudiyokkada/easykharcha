import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, type GestureResponderEvent } from 'react-native';

import { colours, fonts, radii, spacing, type } from '../theme/tokens';
import { CONTROL_HEIGHT } from './constants';
import { Body } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'link';

type Props = {
  label: string;
  onPress?: (event: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
};

/**
 * `.btn` in the kit: full width, pill-shaped, min-height 52. `disabled` and `loading` are states of
 * any variant, not separate variants — the kit's `.btn-disabled` is just what a disabled primary
 * button looks like.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
}: Props) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        isDisabled && variant !== 'link' ? styles.disabled : null,
        pressed && !isDisabled ? styles.pressed : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colours.card : colours.primary}
          accessibilityLabel="Loading"
        />
      ) : null}
      <Body
        style={[
          styles.label,
          textStyles[variant],
          isDisabled && variant !== 'link' ? styles.disabledLabel : null,
        ]}
      >
        {label}
      </Body>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: '100%',
    minHeight: CONTROL_HEIGHT,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: 'transparent',
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    backgroundColor: colours.mint,
    borderColor: 'transparent',
  },
  disabledLabel: {
    color: colours.muted,
  },
  label: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: type.md,
    textAlign: 'center',
  },
});

// All three keep the same full-width, 52px, pill-shaped base — the kit's .btn-link is still a .btn,
// just transparent. It is not a smaller text link.
const variantStyles = StyleSheet.create({
  primary: { backgroundColor: colours.primary },
  secondary: { backgroundColor: colours.card, borderColor: colours.secondary },
  link: { backgroundColor: 'transparent' },
});

const textStyles = StyleSheet.create({
  primary: { color: colours.card },
  secondary: { color: colours.text },
  link: { color: colours.primary },
});
