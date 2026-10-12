import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colours, spacing } from '../theme/tokens';
import { Button } from './Button';

type Props = {
  primaryLabel: string;
  onPrimaryPress: () => void;
  primaryLoading?: boolean;
  primaryDisabled?: boolean;
  skipLabel?: string;
  onSkipPress?: () => void;
};

/**
 * `.action-bar` in the kit: sticky at the bottom, primary action first, an optional "Skip for now"
 * link second — the kit's own markup uses `.btn.btn-link` for Skip, so it's a full `Button`, not a
 * small text link like `StepHeader`'s save-for-later. A plain (non-absolute) block — `Screen`'s own
 * `barWrap` is the thing pinned to the viewport edge and centred at up to 480px; this just fills it.
 */
export function BottomActionBar({
  primaryLabel,
  onPrimaryPress,
  primaryLoading,
  primaryDisabled,
  skipLabel,
  onSkipPress,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: spacing.md + insets.bottom }]}>
      <Button
        label={primaryLabel}
        onPress={onPrimaryPress}
        loading={primaryLoading}
        disabled={primaryDisabled}
      />
      {skipLabel ? <Button label={skipLabel} variant="link" onPress={onSkipPress} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colours.card,
    borderTopWidth: 2,
    borderTopColor: colours.mint,
    padding: spacing.md,
    gap: spacing.sm,
  },
});
