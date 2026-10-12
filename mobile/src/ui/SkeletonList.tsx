import React from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '../theme/tokens';
import { Skeleton } from './Skeleton';

type Props = {
  count?: number;
  height?: number;
};

/** A stack of loading placeholders — the shape every list screen shows while its first fetch is in
 * flight, instead of each screen hand-rolling its own `<Skeleton/>` x N. */
export function SkeletonList({ count = 3, height = 76 }: Props) {
  return (
    <View style={styles.wrap}>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} height={height} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
});
