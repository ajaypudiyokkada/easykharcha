import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colours, fonts, radii, spacing, type } from '../theme/tokens';
import { PROGRESS_BAR_HEIGHT } from './constants';
import { Icon } from './Icon';
import { Small } from './Text';

type Props = {
  current: number;
  total: number;
  onBack?: () => void;
  onSaveForLater?: () => void;
};

/** `.stepper` in the kit: back button, "Step n of N", a dynamic progress bar, and a text link —
 * not a full-width button, the kit's `.save-link` is a plain `<a>`. */
export function StepHeader({ current, total, onBack, onSaveForLater }: Props) {
  const percent = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;

  return (
    <View style={styles.stepper}>
      <View style={styles.top}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={onBack}
            style={styles.back}
          >
            <Icon name="back" size={24} colour={colours.text} />
          </Pressable>
        ) : null}

        <View style={styles.copy}>
          <Text style={styles.stepText}>
            Step {current} of {total}
          </Text>
        </View>

        {onSaveForLater ? (
          <Pressable accessibilityRole="link" onPress={onSaveForLater}>
            <Small style={styles.saveLink}>Save and continue later</Small>
          </Pressable>
        ) : null}
      </View>

      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: total, now: current }}
      >
        <View style={[styles.fill, { width: `${percent}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: {
    backgroundColor: colours.card,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  back: {
    width: spacing.huge,
    height: spacing.huge,
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
  },
  stepText: {
    fontFamily: fonts.heading,
    fontSize: type.md,
    color: colours.text,
  },
  saveLink: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
    textDecorationLine: 'underline',
  },
  track: {
    height: PROGRESS_BAR_HEIGHT,
    backgroundColor: colours.mint,
    borderRadius: radii.pill,
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  fill: {
    height: '100%',
    backgroundColor: colours.primary,
  },
});
