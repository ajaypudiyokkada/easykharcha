import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { strings } from '../strings';
import { colours, radii, spacing } from '../theme/tokens';
import { Button } from './Button';
import { Body, Heading } from './Text';

type Props = {
  visible: boolean;
  onLogin: () => void;
};

/** Shown when a token refresh fails mid-session (AuthContext's authedFetch signs the device out
 * locally the moment that happens) — so the person sees why they're suddenly looking at the login
 * screen, instead of it happening silently. Deliberately no close/cancel — there's nothing to go
 * back to; the only way out is logging in again. */
export function SessionExpiredDialog({ visible, onLogin }: Props) {
  const s = strings.app.sessionExpired;
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Heading level={3}>{s.title}</Heading>
          <Body style={styles.body}>{s.body}</Body>
          <Button label={s.button} variant="primary" onPress={onLogin} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(34,49,46,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colours.card,
    borderRadius: radii.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  body: {
    color: colours.muted,
  },
});
