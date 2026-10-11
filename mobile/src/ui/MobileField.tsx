import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colours, fonts, spacing, type } from '../theme/tokens';
import { CONTROL_HEIGHT } from './constants';
import { TextField, type TextFieldProps } from './TextField';

type Props = Omit<
  TextFieldProps,
  'left' | 'right' | 'keyboardType' | 'maxLength' | 'secureTextEntry'
>;

/**
 * §3 in the kit: a `TextField` with a fixed "+91" prefix, numeric keypad, and a hard 10-digit limit
 * — India's mobile number length, not configurable per the kit.
 */
export function MobileField(props: Props) {
  return (
    <TextField
      {...props}
      keyboardType="number-pad"
      maxLength={10}
      left={
        <View style={styles.prefix}>
          <Text style={styles.prefixText}>+91</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  prefix: {
    minHeight: CONTROL_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRightWidth: 2,
    borderRightColor: colours.mint,
  },
  prefixText: {
    color: colours.text,
    fontFamily: fonts.bodyExtraBold,
    fontSize: type.md,
  },
});
