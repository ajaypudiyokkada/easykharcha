import React from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';

import { colours, radii } from '../theme/tokens';

type Props = {
  width?: DimensionValue;
  height?: number;
  style?: object;
};

/** A plain placeholder block for a loading list/card — no animation (respects reduced-motion by
 * simply never animating at all, the simplest way to honour it). */
export function Skeleton({ width = '100%', height = 20, style }: Props) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.block, { width, height }, style]}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: colours.mint,
    borderRadius: radii.sm,
  },
});
