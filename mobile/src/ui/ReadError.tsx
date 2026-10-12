import React from 'react';
import { StyleSheet, View } from 'react-native';

import { strings } from '../strings';
import { colours, spacing } from '../theme/tokens';
import { Button } from './Button';
import { Body, Heading } from './Text';

type Props = {
  onRetry: () => void;
  loading?: boolean;
};

/** "This read failed, try again" — for any list/detail screen whose data didn't load. Not the same
 * as the app-wide offline gate (that blocks the whole app before sign-in is even confirmed); this is
 * scoped to one screen that otherwise has nothing to show. */
export function ReadError({ onRetry, loading }: Props) {
  const s = strings.app.readError;
  return (
    <View style={styles.wrap}>
      <Heading level={3}>{s.title}</Heading>
      <Body style={styles.body}>{s.body}</Body>
      <Button label={s.retry} variant="secondary" onPress={onRetry} loading={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  body: {
    color: colours.muted,
  },
});
