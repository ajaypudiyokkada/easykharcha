import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colours, spacing } from '../theme/tokens';
import { Button } from './Button';
import { MAX_CONTENT_WIDTH } from './constants';
import { Body, Heading } from './Text';

type Props = {
  title: string;
  body: string;
  retryLabel: string;
  onRetry: () => void;
};

/**
 * A full-screen "can't proceed while offline" gate with a Retry button — the kit's offline state.
 * Used wherever a screen can't show anything meaningful without a network round trip it can't make
 * right now: the root layout's auth bootstrap check, and "/"'s redirect to the landing page.
 */
export function OfflineRetry({ title, body, retryLabel, onRetry }: Props) {
  return (
    <View style={styles.gate}>
      <View style={styles.content}>
        <Heading level={2}>{title}</Heading>
        <Body style={styles.body}>{body}</Body>
        <Button label={retryLabel} variant="primary" onPress={onRetry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    backgroundColor: colours.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  content: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    gap: spacing.lg,
  },
  body: {
    color: colours.muted,
  },
});
