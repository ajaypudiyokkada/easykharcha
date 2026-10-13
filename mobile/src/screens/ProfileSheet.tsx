import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { roleLabel } from '../labels';
import { strings } from '../strings';
import { colours, fonts, radii, spacing } from '../theme/tokens';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { MIN_TOUCH_TARGET } from '../ui/constants';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { Body, Small } from '../ui/Text';

const s = strings.profileSheet;

type Props = {
  visible: boolean;
  onClose: () => void;
};

/** Name, role, business name; "Switch business" (only with more than one); "Account" (disabled,
 * coming soon); "Log out" — reached from the avatar in the top bar (phone) and the user block in
 * the desktop side menu. Replaces every standalone "Log out" button in the app. */
export function ProfileSheet({ visible, onClose }: Props) {
  const { user, businesses, logout, setActiveBusiness } = useAuth();
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const business = businesses[0];

  if (!user || !business) return null;

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
  }

  return (
    <>
      <Sheet visible={visible && !switcherVisible} onClose={onClose} title={s.title}>
        <View style={styles.identity}>
          <Avatar name={user.name} size={56} />
          <Body style={styles.name}>{user.name}</Body>
          <Small style={styles.muted}>
            {roleLabel(business.role ?? '', business.business_type)} · {business.name}
          </Small>
        </View>

        {businesses.length > 1 ? (
          <Pressable
            accessibilityRole="button"
            style={styles.row}
            onPress={() => setSwitcherVisible(true)}
          >
            <Body style={styles.rowLabel}>{s.switchBusiness}</Body>
            <Icon name="chevronRight" size={20} colour={colours.muted} />
          </Pressable>
        ) : null}

        <View style={styles.row}>
          <Body style={styles.rowLabelDisabled}>{s.account}</Body>
          <View style={styles.chip}>
            <Small style={styles.chipText}>{s.comingSoon}</Small>
          </View>
        </View>

        <Button label={s.logOut} variant="secondary" onPress={handleLogout} loading={loggingOut} />
      </Sheet>

      <Sheet
        visible={switcherVisible}
        onClose={() => setSwitcherVisible(false)}
        title={s.switchBusinessTitle}
      >
        <View style={styles.list}>
          {businesses.map((b) => (
            <Pressable
              key={b.id}
              accessibilityRole="button"
              style={styles.row}
              onPress={() => {
                setActiveBusiness(b.id);
                setSwitcherVisible(false);
                onClose();
              }}
            >
              <Body style={styles.rowLabel}>{b.name}</Body>
              {b.id === business.id ? (
                <Icon name="success" size={20} colour={colours.primary} />
              ) : null}
            </Pressable>
          ))}
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  identity: {
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  name: {
    fontFamily: fonts.bodyExtraBold,
  },
  muted: {
    color: colours.muted,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  rowLabel: {
    flex: 1,
    fontFamily: fonts.bodyExtraBold,
  },
  rowLabelDisabled: {
    flex: 1,
    fontFamily: fonts.bodyExtraBold,
    color: colours.muted,
  },
  chip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
  },
  chipText: {
    color: colours.muted,
    fontFamily: fonts.bodyExtraBold,
  },
});
