import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { colours, radii, spacing } from '../theme/tokens';

type Props = {
  children: React.ReactNode;
  style?: ViewStyle;
};

/** `.card` in the kit: a simple bordered container. */
export function Card({ children, style }: Props) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    backgroundColor: colours.card,
    padding: spacing.lg,
  },
});
