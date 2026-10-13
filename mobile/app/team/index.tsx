import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { TeamMember } from '../../src/api/team';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { roleLabel } from '../../src/labels';
import { TeamAddSheet } from '../../src/screens/TeamAddSheet';
import { strings } from '../../src/strings';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import {
  AppShell,
  Body,
  EmptyState,
  Icon,
  NoAccess,
  ReadError,
  Screen,
  SkeletonList,
  Small,
  Toast,
} from '../../src/ui';
import { HOME_CONTENT_WIDTH } from '../../src/ui/constants';

const s = strings.team;

export default function Team() {
  const router = useRouter();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
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

  const businessType = business?.business_type ?? '';

  return (
    <AppShell active="team">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <View>
          <Body style={styles.title}>{s.title}</Body>
          <Small style={styles.subtitle}>{s.subtitle}</Small>
        </View>

        {!canManage ? <Small style={styles.managerNote}>{s.managerNote}</Small> : null}

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading || !members ? (
          <SkeletonList count={3} height={72} />
        ) : members.length > 0 ? (
          <View style={styles.list}>
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                businessType={businessType}
                isYou={member.user_id === user.id}
                onPress={() => router.push(`/team/${member.id}`)}
              />
            ))}
          </View>
        ) : canManage ? (
          <EmptyState
            icon="team"
            title={s.empty.message}
            buttonLabel={s.empty.ownerButton}
            onPress={() => setAddVisible(true)}
          />
        ) : (
          <EmptyState
            icon="team"
            title={s.empty.message}
            buttonLabel={s.empty.managerButton}
            onPress={() => router.replace('/home')}
          />
        )}

        {canManage && members && members.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setAddVisible(true)}
            style={styles.addButton}
          >
            <Icon name="plus" size={18} colour={colours.primary} />
            <Body style={styles.addButtonText}>{s.addTeamMember}</Body>
          </Pressable>
        ) : null}
      </Screen>

      <TeamAddSheet
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onSaved={() => {
          setAddVisible(false);
          setToast(strings.teamAddSheet.savedToast);
          load();
        }}
      />
      <Toast message={toast} onHide={() => setToast(null)} />
    </AppShell>
  );
}

function MemberRow({
  member,
  businessType,
  isYou,
  onPress,
}: {
  member: TeamMember;
  businessType: string;
  isYou: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={member.name}
      onPress={onPress}
      style={styles.row}
    >
      <View style={styles.rowMain}>
        <View style={styles.rowNameLine}>
          <Body style={styles.rowName}>{member.name}</Body>
          {isYou ? (
            <View style={styles.youChip}>
              <Small style={styles.youChipText}>{strings.team.you}</Small>
            </View>
          ) : null}
        </View>
        <Small style={styles.rowMeta}>
          {roleLabel(member.role, businessType)} · {member.mobile}
        </Small>
        {!member.last_login_at ? (
          <Small style={styles.neverLoggedIn}>{strings.team.neverLoggedIn}</Small>
        ) : null}
      </View>
      <Icon name="chevronRight" size={20} colour={colours.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  title: {
    fontFamily: fonts.headingBold,
  },
  subtitle: {
    color: colours.muted,
  },
  managerNote: {
    color: colours.muted,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowName: {
    fontFamily: fonts.bodyExtraBold,
  },
  youChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
  },
  youChipText: {
    fontFamily: fonts.bodyExtraBold,
    color: colours.primary,
  },
  rowMeta: {
    color: colours.muted,
  },
  neverLoggedIn: {
    color: colours.warning,
    fontFamily: fonts.bodyExtraBold,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderWidth: 2,
    borderColor: colours.primary,
    borderRadius: radii.pill,
  },
  addButtonText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
});
