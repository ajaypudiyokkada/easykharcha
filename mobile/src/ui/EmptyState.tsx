import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colours, radii, spacing } from '../theme/tokens';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Body, Heading } from './Text';

type Props = {
  icon?: IconName;
  title: string;
  body?: string;
  buttonLabel: string;
  onPress: () => void;
};

/** Nothing here yet — one message, one way forward. Never more than one button: a second one just
 * splits attention on a screen that has nothing else to show. */
export function EmptyState({ icon = 'stock', title, body, buttonLabel, onPress }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Icon name={icon} size={28} colour={colours.primary} />
      </View>
      <Heading level={3}>{title}</Heading>
      {body ? <Body style={styles.body}>{body}</Body> : null}
      <Button label={buttonLabel} variant="primary" onPress={onPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    textAlign: 'center',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: radii.lg,
    backgroundColor: colours.mint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  body: {
    color: colours.muted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
});
