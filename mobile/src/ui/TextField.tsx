import React, { useId, useState } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';

import { colours, fonts, radii, spacing, type } from '../theme/tokens';
import { CONTROL_HEIGHT } from './constants';
import { Icon } from './Icon';
import { Muted, Small } from './Text';

export type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  success?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: TextInputProps['autoComplete'];
  maxLength?: number;
  autoFocus?: boolean;
  editable?: boolean;
  /** e.g. the fixed "+91" prefix `MobileField` renders. */
  left?: React.ReactNode;
  /** e.g. the Show/Hide toggle `PasswordField` renders. */
  right?: React.ReactNode;
};

/**
 * `.field` / `.input-wrap` in the kit — label, hint, and the five states (empty, focused, filled,
 * error, success). `MobileField` and `PasswordField` are thin configurations of this, not separate
 * implementations, so the border/focus/error chrome exists in exactly one place.
 */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  success,
  secureTextEntry,
  keyboardType,
  autoComplete,
  maxLength,
  autoFocus,
  editable = true,
  left,
  right,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const statusId = useId();

  const status = error
    ? 'error'
    : success
      ? 'success'
      : focused
        ? 'focused'
        : value
          ? 'filled'
          : 'empty';

  return (
    <View style={styles.field}>
      <Small accessibilityRole="none" style={styles.label}>
        {label}
      </Small>

      <View style={[styles.inputWrap, wrapStatusStyles[status]]}>
        {left}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colours.muted}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          maxLength={maxLength}
          autoFocus={autoFocus}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.input}
          accessibilityLabel={label}
          // Cross-platform aria-* prop aliases (RN 0.71+): map to the real DOM attribute on web, and
          // to the native accessibility description on iOS/Android.
          aria-invalid={Boolean(error)}
          aria-describedby={error || success || hint ? statusId : undefined}
        />
        {right}
      </View>

      {error ? (
        <View nativeID={statusId} style={styles.status} accessibilityLiveRegion="polite">
          <Icon name="error" size={type.md} colour={colours.danger} />
          <Small style={styles.errorText}>{error}</Small>
        </View>
      ) : success ? (
        <View nativeID={statusId} style={styles.status} accessibilityLiveRegion="polite">
          <Icon name="success" size={type.md} colour={colours.success} />
          <Small style={styles.successText}>{success}</Small>
        </View>
      ) : hint ? (
        <Muted size="sm" nativeID={statusId}>
          {hint}
        </Muted>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  label: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: type.md,
  },
  inputWrap: {
    minHeight: CONTROL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colours.card,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: spacing.huge,
    paddingHorizontal: spacing.md,
    color: colours.text,
    fontFamily: fonts.body,
    fontSize: type.md,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  errorText: {
    flex: 1,
    color: colours.danger,
    fontFamily: fonts.bodyExtraBold,
  },
  successText: {
    flex: 1,
    color: colours.success,
    fontFamily: fonts.bodyExtraBold,
  },
});

// `.input-wrap.focused{border-color:primary;outline:3px solid mint}` — the outline ring is a
// web-only CSS concept with no typed ViewStyle equivalent in React Native core, so it's added only
// on web (where react-native-web renders a real CSS outline); native platforms get the border-colour
// change alone, which is still a clear, visible focus state.
const webFocusRing =
  Platform.OS === 'web'
    ? ({ outlineWidth: 3, outlineColor: colours.mint, outlineStyle: 'solid' } as Record<
        string,
        unknown
      >)
    : {};

const wrapStatusStyles = StyleSheet.create({
  empty: {},
  filled: {},
  focused: { borderColor: colours.primary, ...webFocusRing },
  error: { borderColor: colours.danger },
  success: { borderColor: colours.success },
});
