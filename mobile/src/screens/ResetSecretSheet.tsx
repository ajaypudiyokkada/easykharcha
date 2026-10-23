import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ApiError } from '../api/client';
import type { TeamMember } from '../api/team';
import { useAuth } from '../auth/AuthContext';
import { strings } from '../strings';
import { colours, spacing } from '../theme/tokens';
import { Banner, PasswordField, Sheet } from '../ui';
import { Button } from '../ui/Button';
import { Small } from '../ui/Text';

const s = strings.resetSecretSheet;

type Props = {
  visible: boolean;
  member: TeamMember | null;
  /** The member's PIN roles (Head chef/Helper) reset a PIN; Manager resets a password. */
  usesPin: boolean;
  onClose: () => void;
  onSaved: (member: TeamMember) => void;
};

/** `resetPinDialog` / the password equivalent — the Owner sets a new secret for a member directly
 * (not a reset-link flow), shown once and never again, so the Owner can hand it to them in person. */
export function ResetSecretSheet({ visible, member, usesPin, onClose, onSaved }: Props) {
  const { authedFetch, businesses } = useAuth();
  const business = businesses[0];

  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSecret('');
    setError(null);
    setFormError(null);
  }, [visible]);

  async function handleReset() {
    if (!secret.trim()) {
      setError(s.errors.secretRequired);
      return;
    }
    if (!business || !member) return;

    setSaving(true);
    setFormError(null);
    try {
      const updated = await authedFetch<TeamMember>(
        `/businesses/${business.id}/team/${member.id}/reset-secret/`,
        { method: 'POST', body: { secret } },
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
    <Sheet visible={visible} onClose={onClose} title={usesPin ? s.pinTitle : s.passwordTitle}>
      {formError ? <Banner kind="error">{formError}</Banner> : null}

      {usesPin ? (
        <PasswordField
          mode="pin"
          label={s.pinLabel}
          value={secret}
          onChangeText={(value) => setSecret(value.replace(/[^0-9]/g, ''))}
          maxLength={6}
          resetSignal={visible}
          hint={error ? undefined : s.pinHint}
          error={error ?? undefined}
        />
      ) : (
        <PasswordField
          label={s.passwordLabel}
          value={secret}
          onChangeText={setSecret}
          // This resets someone else's password, not the signed-in Owner's own — "off" stops
          // Chrome/the OS from offering to generate/save it to the Owner's own account.
          autoComplete="off"
          resetSignal={visible}
          error={error ?? undefined}
        />
      )}

      <Small style={styles.note}>{s.note}</Small>

      <View style={styles.actions}>
        <Button
          label={usesPin ? s.resetPin : s.resetPassword}
          variant="primary"
          onPress={handleReset}
          loading={saving}
        />
        <Button
          label={usesPin ? s.keepCurrentPin : s.keepCurrentPassword}
          variant="secondary"
          onPress={onClose}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  note: {
    color: colours.muted,
    marginTop: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
