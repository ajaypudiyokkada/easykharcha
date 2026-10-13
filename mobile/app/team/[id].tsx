import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { TeamMember } from '../../src/api/team';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { formatDateTime } from '../../src/format';
import { roleLabel } from '../../src/labels';
import { ChangeRoleSheet } from '../../src/screens/ChangeRoleSheet';
import { ResetSecretSheet } from '../../src/screens/ResetSecretSheet';
import { strings } from '../../src/strings';
import { colours, fonts, spacing } from '../../src/theme/tokens';
import {
  AppShell,
  Body,
  Button,
  Card,
  ConfirmDialog,
  Heading,
  NoAccess,
  ReadError,
  Screen,
  SkeletonList,
  Small,
  Toast,
} from '../../src/ui';
import { HOME_CONTENT_WIDTH } from '../../src/ui/constants';

const s = strings.memberDetail;
const PIN_ROLES = new Set(['head_chef', 'helper']);

export default function MemberDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [changeRoleVisible, setChangeRoleVisible] = useState(false);
  const [resetVisible, setResetVisible] = useState(false);
  const [removeVisible, setRemoveVisible] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!business) return;
    setLoading(true);
    setFailed(false);
    authedFetch<TeamMember[]>(`/businesses/${business.id}/team/`)
      .then(setMembers)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [business, authedFetch]);

  useEffect(() => {
    load();
  }, [load]);

  if (status === 'bootstrapping') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }
  if (status === 'signedOut' || !user) {
    return <Redirect href="/login" />;
  }

  const canManage = can(permissions, 'team.manage');
  const canView = canManage || can(permissions, 'team.view');
  if (!canView) {
    return (
      <AppShell active="team">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  const member = members?.find((row) => String(row.id) === id) ?? null;
  const businessType = business?.business_type ?? '';
  const timezone = business?.timezone ?? 'Asia/Kolkata';
  const isYou = Boolean(member && member.user_id === user.id);
  const isOwnerRow = member?.role === 'owner';
  const showActions = canManage && member && !isOwnerRow;

  function updateMember(updated: TeamMember) {
    setMembers((current) => current?.map((row) => (row.id === updated.id ? updated : row)) ?? null);
  }

  async function handleRemove() {
    if (!business || !member) return;
    setRemoving(true);
    try {
      await authedFetch(`/businesses/${business.id}/team/${member.id}/`, { method: 'DELETE' });
      setRemoveVisible(false);
      setToast(strings.removeMemberDialog.removedToast(member.name));
      router.replace('/team');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <AppShell active="team">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{s.title}</Heading>

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading || !members ? (
          <SkeletonList count={2} height={100} />
        ) : !member ? (
          <ReadError onRetry={load} loading={false} />
        ) : (
          <>
            <Card style={styles.card}>
              <Body style={styles.name}>{member.name}</Body>
              <Small style={styles.meta}>
                {roleLabel(member.role, businessType)} · {member.mobile}
              </Small>
              <Small style={styles.meta}>
                {s.addedOn(formatDateTime(member.added_at, timezone))}
              </Small>
              <Small style={styles.meta}>
                {member.last_login_at
                  ? s.lastLogin(formatDateTime(member.last_login_at, timezone))
                  : s.neverLoggedIn}
              </Small>
            </Card>

            {!canManage ? <Small style={styles.note}>{s.managerNote}</Small> : null}
            {canManage && isYou ? <Small style={styles.note}>{s.ownRowNote}</Small> : null}

            {showActions ? (
              <View style={styles.actions}>
                <Button
                  label={s.changeRole}
                  variant="secondary"
                  onPress={() => setChangeRoleVisible(true)}
                />
                <Button
                  label={PIN_ROLES.has(member.role) ? s.resetPin : s.resetPassword}
                  variant="secondary"
                  onPress={() => setResetVisible(true)}
                />
                <Button
                  label={s.removeFromTeam}
                  variant="primary"
                  colour={colours.danger}
                  onPress={() => setRemoveVisible(true)}
                />
              </View>
            ) : null}
          </>
        )}
      </Screen>

      <ChangeRoleSheet
        visible={changeRoleVisible}
        member={member}
        onClose={() => setChangeRoleVisible(false)}
        onSaved={(updated) => {
          setChangeRoleVisible(false);
          updateMember(updated);
          setToast(strings.changeRoleSheet.savedToast);
        }}
      />

      <ResetSecretSheet
        visible={resetVisible}
        member={member}
        usesPin={Boolean(member && PIN_ROLES.has(member.role))}
        onClose={() => setResetVisible(false)}
        onSaved={(updated) => {
          setResetVisible(false);
          updateMember(updated);
          setToast(
            member && PIN_ROLES.has(member.role)
              ? strings.resetSecretSheet.pinSavedToast
              : strings.resetSecretSheet.passwordSavedToast,
          );
        }}
      />

      <ConfirmDialog
        visible={removeVisible}
        title={member ? strings.removeMemberDialog.title(member.name) : ''}
        body={strings.removeMemberDialog.body}
        confirmLabel={strings.removeMemberDialog.confirm}
        cancelLabel={strings.removeMemberDialog.cancel}
        onConfirm={handleRemove}
        onCancel={() => setRemoveVisible(false)}
        confirmLoading={removing}
      />
      <Toast message={toast} onHide={() => setToast(null)} />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  card: {
    gap: spacing.xs,
  },
  name: {
    fontFamily: fonts.bodyExtraBold,
  },
  meta: {
    color: colours.muted,
  },
  note: {
    color: colours.muted,
  },
  actions: {
    gap: spacing.sm,
  },
});
