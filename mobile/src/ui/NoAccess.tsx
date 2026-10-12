import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { strings } from '../strings';
import { colours, radii, spacing } from '../theme/tokens';
import { Button } from './Button';
import { Icon } from './Icon';
import { Body, Heading } from './Text';

/** The route guard's own screen: shown in place of a screen's content when the signed-in person's
 * role doesn't carry the permission it needs — never a silent redirect, so it's clear why. */
export function NoAccess() {
  const router = useRouter();
  const s = strings.app.noAccess;
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Icon name="lock" size={28} colour={colours.primary} />
      </View>
      <Heading level={3}>{s.title}</Heading>
      <Body style={styles.body}>{s.body}</Body>
      <Button label={s.goHome} variant="primary" onPress={() => router.replace('/home')} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
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
