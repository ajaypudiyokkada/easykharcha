import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colours, fonts } from '../theme/tokens';
import { Small } from './Text';

type Props = {
  name: string;
  size?: number;
};

/** First letter of the first and last word of a name (one letter if there's only one word) — no
 * profile photo exists anywhere in this app, so initials are the only avatar there is. */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

export function Avatar({ name, size = 40 }: Props) {
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      <Small style={styles.text}>{initialsFor(name)}</Small>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    backgroundColor: colours.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: colours.card,
    fontFamily: fonts.bodyExtraBold,
  },
});
