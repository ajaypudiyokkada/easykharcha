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

const s = strings.teamAddSheet;
const MOBILE_PATTERN = /^[6-9][0-9]{9}$/;
const ROLES = ['manager', 'head_chef', 'helper'] as const;
type Role = (typeof ROLES)[number];

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: (member: TeamMember) => void;
};

/** `teamAddSheet` — the Team screen's own Add team member sheet. Same single-person shape as the
 * setup wizard's /setup/5 "add a person" form, but standalone: one POST, one result, no pending
 * list to manage, since here the member list it adds to already exists on the server. */
export function TeamAddSheet({ visible, onClose, onSaved }: Props) {
  const { authedFetch, businesses } = useAuth();
  const business = businesses[0];

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [secret, setSecret] = useState('');
  const [errors, setErrors] = useState<
    Partial<Record<'name' | 'mobile' | 'role' | 'secret', string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName('');
    setMobile('');
    setRole('');
    setSecret('');
    setErrors({});
    setFormError(null);
  }, [visible]);

  async function handleSave() {
    const nextErrors: typeof errors = {};
    if (!name.trim()) nextErrors.name = s.errors.nameRequired;
    if (!MOBILE_PATTERN.test(mobile)) nextErrors.mobile = s.errors.mobileInvalid;
    if (!role) nextErrors.role = s.errors.roleRequired;
    if (!secret.trim()) nextErrors.secret = s.errors.secretRequired;
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0 || !business || !role) return;

    setSaving(true);
    try {
      const member = await authedFetch<TeamMember>(`/businesses/${business.id}/team/`, {
        method: 'POST',
        body: { name: name.trim(), mobile, role, secret },
      });
      onSaved(member);
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
        <TextField
          label={s.nameLabel}
          value={name}
          onChangeText={setName}
          placeholder={s.namePlaceholder}
          autoComplete="name"
          error={errors.name}
        />

        <TextField
          label={s.mobileLabel}
          value={mobile}
          onChangeText={(value) => setMobile(value.replace(/[^0-9]/g, ''))}
          placeholder={s.mobilePlaceholder}
          keyboardType="phone-pad"
          autoComplete="tel"
          maxLength={10}
          error={errors.mobile}
        />

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
          {errors.role ? <Small style={styles.errorText}>{errors.role}</Small> : null}
        </View>

        {role === 'manager' ? (
          <PasswordField
            label={s.passwordLabel}
            value={secret}
            onChangeText={setSecret}
            // This sets someone else's temporary password, not the signed-in Owner's own — "off"
            // stops Chrome/the OS from offering to generate/save it to the Owner's own account.
            autoComplete="off"
            resetSignal={visible}
            error={errors.secret}
          />
        ) : (
          <PasswordField
            mode="pin"
            label={s.pinLabel}
            value={secret}
            onChangeText={(value) => setSecret(value.replace(/[^0-9]/g, ''))}
            maxLength={6}
            resetSignal={visible}
            hint={errors.secret ? undefined : s.pinHint}
            error={errors.secret}
          />
        )}

        {role ? <Small style={styles.reminder}>{s.secretReminder}</Small> : null}

        <Button label={s.save} variant="primary" onPress={handleSave} loading={saving} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
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
  reminder: {
    color: colours.warning,
    fontFamily: fonts.bodyExtraBold,
  },
});
