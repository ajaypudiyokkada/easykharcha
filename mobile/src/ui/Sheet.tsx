import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMinWidth } from '../hooks/useMinWidth';
import { colours, radii, spacing } from '../theme/tokens';
import { BREAKPOINT_TABLET, MIN_TOUCH_TARGET } from './constants';
import { Icon } from './Icon';
import { Heading } from './Text';

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

/**
 * A bottom sheet on phones, a centred dialog from `BREAKPOINT_TABLET` up — the same pattern as the
 * approved prototype's `.sheet`/`.dialog`. Used for the More menu and Record purchase; `ConfirmDialog`
 * is the simpler two-button variant for destructive confirmations.
 */
export function Sheet({ visible, onClose, title, children }: Props) {
  const insets = useSafeAreaInsets();
  const isWide = useMinWidth(BREAKPOINT_TABLET);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* A plain tap-to-dismiss backdrop, not a labelled control — the close affordance a screen
          reader announces is the dedicated close button below. Giving this one `role="button"` too
          renders an HTML <button> wrapping another real <button>, which is invalid nesting the
          browser silently repairs by splitting the tree, corrupting everything inside it. */}
      <Pressable
        style={[styles.overlay, isWide ? styles.overlayCentred : styles.overlayBottom]}
        onPress={onClose}
      >
        <Pressable
          style={[
            styles.panel,
            isWide ? styles.dialog : styles.sheet,
            { paddingBottom: spacing.xl + (isWide ? 0 : insets.bottom) },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.head}>
            <Heading level={3}>{title}</Heading>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={styles.closeBtn}
            >
              <Icon name="close" size={20} colour={colours.text} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(34,49,46,0.35)',
  },
  overlayBottom: {
    justifyContent: 'flex-end',
  },
  overlayCentred: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  panel: {
    backgroundColor: colours.card,
    maxHeight: '86%',
  },
  sheet: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
  },
  dialog: {
    width: '100%',
    maxWidth: 480,
    borderRadius: radii.lg,
    padding: spacing.xl,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  closeBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
