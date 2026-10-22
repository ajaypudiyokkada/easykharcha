import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ApiError } from '../api/client';
import type { TeamMember } from '../api/team';
import { useAuth } from '../auth/AuthContext';
import { roleLabel } from '../labels';
import { strings } from '../strings';
import { colours, fonts, radii, spacing } from '../theme/tokens';
import { Banner, PasswordField, Sheet } from '../ui';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { Small } from '../ui/Text';

const s = strings.changeRoleSheet;
const ROLES = ['manager', 'head_chef', 'helper'] as const;
type Role = (typeof ROLES)[number];

type Props = {
  visible: boolean;
  member: TeamMember | null;
  onClose: () => void;
  onSaved: (member: TeamMember) => void;
};

/** Change role — Helper/Head chef swap freely, but a role crossing the Manager boundary (either
 * direction) needs a new secret in the same request, since a PIN and a password aren't
 * interchangeable and the server has no safe default to fall back to. */
export function ChangeRoleSheet({ visible, member, onClose, onSaved }: Props) {
  const { authedFetch, businesses } = useAuth();
  const business = businesses[0];

  const [role, setRole] = useState<Role | ''>('');
  const [secret, setSecret] = useState('');
  const [secretVisible, setSecretVisible] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !member) return;
    setRole((member.role as Role) ?? '');
    setSecret('');
    setSecretVisible(false);
    setRoleError(null);
    setSecretError(null);
    setFormError(null);
  }, [visible, member]);

  const needsSecret = Boolean(
    member && role && (role === 'manager') !== (member.role === 'manager'),
  );

  async function handleSave() {
    if (!role) {
      setRoleError(s.errors.roleRequired);
      return;
    }
    setRoleError(null);
    if (needsSecret && !secret.trim()) {
      setSecretError(s.errors.secretRequired);
      return;
    }
    setSecretError(null);
    if (!business || !member) return;

    setSaving(true);
    setFormError(null);
    try {
      const updated = await authedFetch<TeamMember>(
        `/businesses/${business.id}/team/${member.id}/`,
        {
          method: 'PATCH',
          body: needsSecret ? { role, secret } : { role },
        },
      );
      onSaved(updated);
    } catch (err) {
      if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
        setFormError(s.errors.network);
      } else if (err instanceof ApiError) {
        setFormError(err.message || s.errors.generic);
      } else {
        setFormError(s.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={s.title}>
      {formError ? <Banner kind="error">{formError}</Banner> : null}

      <View style={styles.field}>
        <Small style={styles.label}>{s.roleLabel}</Small>
        <View style={styles.roleChips}>
          {ROLES.map((value) => {
            const selected = role === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => setRole(value)}
                style={[styles.roleChip, selected ? styles.roleChipSelected : null]}
              >
                <Small style={selected ? styles.roleChipTextSelected : styles.roleChipText}>
                  {roleLabel(value, business?.business_type ?? '')}
                </Small>
              </Pressable>
            );
          })}
        </View>
        {roleError ? <Small style={styles.errorText}>{roleError}</Small> : null}
      </View>

      {needsSecret ? (
        <View style={styles.field}>
          <Small style={styles.secretNote}>{s.secretNote}</Small>
          {role === 'manager' ? (
            <PasswordField
              label={s.passwordLabel}
              value={secret}
              onChangeText={setSecret}
              // This sets someone else's new password, not the signed-in Owner's own — "off" stops
              // Chrome/the OS from offering to generate/save it to the Owner's own account.
              autoComplete="off"
              error={secretError ?? undefined}
            />
          ) : (
            <TextField
              label={s.pinLabel}
              value={secret}
              onChangeText={(value) => setSecret(value.replace(/[^0-9]/g, ''))}
              secureTextEntry={!secretVisible}
              keyboardType="number-pad"
              maxLength={6}
              error={secretError ?? undefined}
              right={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={secretVisible ? 'Hide PIN' : 'Show PIN'}
                  onPress={() => setSecretVisible((current) => !current)}
                  style={styles.secretToggle}
                >
                  <Small style={styles.secretToggleText}>{secretVisible ? 'Hide' : 'Show'}</Small>
                </Pressable>
              }
            />
          )}
        </View>
      ) : null}

      <Button label={s.save} variant="primary" onPress={handleSave} loading={saving} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  label: {
    fontFamily: fonts.bodyExtraBold,
  },
  roleChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  roleChip: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.pill,
    backgroundColor: colours.card,
  },
  roleChipSelected: {
    borderColor: colours.primary,
    backgroundColor: colours.mint,
  },
  roleChipText: {
    color: colours.text,
  },
  roleChipTextSelected: {
    color: colours.text,
    fontFamily: fonts.bodyExtraBold,
  },
  errorText: {
    color: colours.danger,
    fontFamily: fonts.bodyExtraBold,
  },
  secretNote: {
    color: colours.warning,
    fontFamily: fonts.bodyExtraBold,
  },
  secretToggle: {
    minWidth: spacing.huge + spacing.xl,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  secretToggleText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
});
