import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { CountListEntry } from '../../src/api/counts';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { formatDateTime } from '../../src/format';
import { strings } from '../../src/strings';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import {
  AppShell,
  Body,
  Button,
  Heading,
  Icon,
  NoAccess,
  ReadError,
  Screen,
  Sheet,
  SkeletonList,
  Small,
  Toast,
} from '../../src/ui';
import { HOME_CONTENT_WIDTH } from '../../src/ui/constants';

const s = strings.countReview;

export default function CountReview() {
  const router = useRouter();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [counts, setCounts] = useState<CountListEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [remindTarget, setRemindTarget] = useState<CountListEntry | null>(null);
  const [waLink, setWaLink] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!business) return;
    setLoading(true);
    setFailed(false);
    authedFetch<CountListEntry[]>(`/businesses/${business.id}/counts/`)
      .then(setCounts)
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
  if (!can(permissions, 'counts.review')) {
    return (
      <AppShell active="home">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  // The remind endpoint itself is hardcoded Owner-only on the server (no permission string covers
  // it), so this checks the same thing the server actually checks, not a role name used as a
  // permission substitute.
  const isOwner = business?.role === 'owner';
  const flaggedCount = (counts ?? []).find((count) => count.items_not_sure > 0);

  async function openRemind(count: CountListEntry) {
    if (!business) return;
    setRemindTarget(count);
    setWaLink(null);
    setSending(true);
    try {
      const response = await authedFetch<{ wa_link: string }>(
        `/businesses/${business.id}/counts/remind/`,
        { method: 'POST', body: { type: count.count_type, user_id: count.counted_by } },
      );
      setWaLink(response.wa_link);
    } finally {
      setSending(false);
    }
  }

  return (
    <AppShell active="home">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{s.title}</Heading>
        <Body style={styles.subtitle}>{s.subtitle}</Body>

        {flaggedCount ? (
          <Button
            label={s.reviewFlagged}
            variant="primary"
            onPress={() => router.push(`/counts/${flaggedCount.id}`)}
          />
        ) : null}

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading ? (
          <SkeletonList count={2} height={110} />
        ) : counts && counts.length > 0 ? (
          <View style={styles.list}>
            {counts.map((count) => (
              <View key={count.id} style={styles.card}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    count.count_type === 'opening'
                      ? s.openingCount(count.counted_by_name)
                      : s.closingCount(count.counted_by_name)
                  }
                  onPress={() => router.push(`/counts/${count.id}`)}
                  style={styles.cardHead}
                >
                  <View style={styles.cardMain}>
                    <Body style={styles.cardTitle}>
                      {count.count_type === 'opening'
                        ? s.openingCount(count.counted_by_name)
                        : s.closingCount(count.counted_by_name)}
                    </Body>
                    <Small style={styles.cardMeta}>
                      {formatDateTime(count.submitted_at, business?.timezone ?? 'Asia/Kolkata')} ·{' '}
                      {s.itemsCounted(count.items_counted)}
                      {count.items_not_sure > 0 ? ` · ${s.notSureCount(count.items_not_sure)}` : ''}
                    </Small>
                  </View>
                  {count.is_late ? (
                    <View style={styles.lateChip}>
                      <Icon name="clock" size={14} colour={colours.warning} />
                      <Small style={styles.lateChipText}>{s.lateBy(count.minutes_late)}</Small>
                    </View>
                  ) : (
                    <View style={styles.onTimeChip}>
                      <Small style={styles.onTimeChipText}>{s.onTime}</Small>
                    </View>
                  )}
                </Pressable>
                {count.is_late && isOwner ? (
                  <View style={styles.remindRow}>
                    <View style={styles.remindBtn}>
                      <Button
                        label={s.remind(count.counted_by_name)}
                        variant="primary"
                        onPress={() => openRemind(count)}
                      />
                    </View>
                    <View style={styles.remindBtn}>
                      <Button
                        label={s.countItMyself}
                        variant="link"
                        onPress={() => router.push('/count')}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ) : (
          <Body style={styles.subtitle}>{s.empty}</Body>
        )}
      </Screen>

      <Sheet
        visible={Boolean(remindTarget)}
        onClose={() => setRemindTarget(null)}
        title={remindTarget ? s.remindSheetTitle(remindTarget.counted_by_name) : ''}
      >
        <Body style={styles.subtitle}>{s.remindSheetSubtitle}</Body>
        {waLink ? (
          <View style={styles.messagePreview}>
            <Small>{waLink}</Small>
          </View>
        ) : null}
        <Button
          label={s.prepareReminder}
          variant="primary"
          loading={sending}
          onPress={() => {
            setRemindTarget(null);
            setToast(s.reminderReadyToast);
          }}
        />
      </Sheet>
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
  subtitle: {
    color: colours.muted,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardMain: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontFamily: fonts.bodyExtraBold,
    textAlign: 'left',
  },
  cardMeta: {
    color: colours.muted,
  },
  lateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
  },
  lateChipText: {
    color: colours.warning,
    fontFamily: fonts.bodyExtraBold,
  },
  onTimeChip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colours.success,
  },
  onTimeChipText: {
    color: colours.card,
    fontFamily: fonts.bodyExtraBold,
  },
  remindRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  remindBtn: {
    flex: 1,
  },
  messagePreview: {
    backgroundColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
});
