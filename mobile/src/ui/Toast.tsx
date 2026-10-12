import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';

import { colours, radii, spacing } from '../theme/tokens';
import { Small } from './Text';

type Props = {
  message: string | null;
  onHide: () => void;
};

const VISIBLE_MS = 2200;
const FADE_MS = 150;

/** A brief bottom-anchored confirmation ("Purchase saved") that disappears on its own — no
 * precedent in the kit before Step 9, so this is deliberately the simplest thing that works on
 * both web and native: an Animated opacity, no portal/provider plumbing. */
export function Toast({ message, onHide }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(
        onHide,
      );
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!message) return null;

  return (
    <Animated.View style={[styles.toast, { opacity }]} pointerEvents="none">
      <Small style={styles.text}>{message}</Small>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: 95,
    alignItems: 'center',
  },
  text: {
    color: colours.card,
    backgroundColor: colours.text,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
  },
});
