import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { colours, radii, spacing } from '../theme/tokens';
import { Body, Heading } from './Text';
import { Button } from './Button';

type Props = {
  visible: boolean;
  title: string;
  body: string;
  /** e.g. "Delete purchase" — the danger button repeats the verb, never just "Yes". */
  confirmLabel: string;
  /** e.g. "Keep it" — always offered, so backing out never feels like a trap. */
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLoading?: boolean;
};

/** A destructive-action confirmation — names the thing being deleted, never a bare "Are you sure?". */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmLoading,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/* A plain tap-to-dismiss backdrop, not a labelled control — see Sheet.tsx's overlay comment:
          `role="button"` here would nest an HTML <button> around the real Cancel/Confirm buttons
          below, which the browser silently repairs by splitting the tree. */}
      <Pressable style={styles.overlay} onPress={onCancel}>
        <Pressable style={styles.dialog} onPress={(event) => event.stopPropagation()}>
          <Heading level={3}>{title}</Heading>
          <Body style={styles.body}>{body}</Body>
          <View style={styles.actions}>
            <Button
              label={confirmLabel}
              variant="primary"
              colour={colours.danger}
              onPress={onConfirm}
              loading={confirmLoading}
            />
            <Button label={cancelLabel} variant="secondary" onPress={onCancel} />
          </View>
        </Pressable>
      </Pressable>
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
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
