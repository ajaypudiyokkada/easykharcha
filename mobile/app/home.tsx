import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';

import type { PurchaseListResponse } from '../src/api/purchases';
import type { TodayStatus } from '../src/api/counts';
import type { WastageListResponse } from '../src/api/wastage';
import { useAuth } from '../src/auth/AuthContext';
import { can, isLimitedRole } from '../src/auth/permissions';
import { formatDateTime, formatRupees } from '../src/format';
import { RecordPurchaseSheet } from '../src/screens/RecordPurchaseSheet';
import { RecordWastageSheet } from '../src/screens/RecordWastageSheet';
import { bestTextOn, ensureContrast } from '../src/theme/brand';
import { strings } from '../src/strings';
import {
  Body,
  Button,
  Card,
  Heading,
  Icon,
  type IconName,
  Muted,
  Screen,
  Small,
  SkeletonList,
  Toast,
} from '../src/ui';
import { AppShell } from '../src/ui/AppShell';
import { HOME_CONTENT_WIDTH } from '../src/ui/constants';
import { colours, fonts, radii, spacing, type } from '../src/theme/tokens';

const s = strings.home;
const t = strings.today;

export default function Home() {
  const { status, user, businesses } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

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

  if (isLimitedRole(permissions)) {
    return <TodayHome />;
  }
  return <OwnerHome />;
}

/** Head chef / Helper: a greeting, two big buttons, the deadline, and today's entries — their own
 * for a Helper, the team's for a Head chef (who also gets a team-progress line). */
function TodayHome() {
  const router = useRouter();
  const { user, businesses, authedFetch, logout } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];
  const canRecordWastage = can(permissions, 'wastage.create');
  const timezone = business?.timezone ?? 'Asia/Kolkata';

  const [today, setToday] = useState<TodayStatus | null>(null);
  const [wastage, setWastage] = useState<WastageListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [wasteSheetVisible, setWasteSheetVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const load = useCallback(() => {
    if (!business) return;
    setLoading(true);
    Promise.all([
      authedFetch<TodayStatus>(`/businesses/${business.id}/today/`),
      authedFetch<WastageListResponse>(`/businesses/${business.id}/wastage/`),
    ])
      .then(([todayRes, wastageRes]) => {
        setToday(todayRes);
        setWastage(wastageRes);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [business, authedFetch]);

  useEffect(() => {
    load();
  }, [load]);

  if (!user || !business) {
    return (
      <AppShell active="home">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <SkeletonList count={3} height={100} />
        </Screen>
      </AppShell>
    );
  }

  const nextCount =
    today?.opening.state !== 'done'
      ? { type: 'opening' as const, info: today?.opening }
      : { type: 'closing' as const, info: today?.closing };
  const deadlineLabel = nextCount.info
    ? nextCount.type === 'opening'
      ? t.openingDue(formatDateTime(nextCount.info.deadline_at, timezone))
      : t.closingDue(formatDateTime(nextCount.info.deadline_at, timezone))
    : null;

  const isHeadChef = can(permissions, 'counts.status');

  return (
    <AppShell active="home">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <View style={styles.todayHero}>
          <Heading level={1} style={styles.todayHeroTitle}>
            {t.greeting(user.name)}
          </Heading>
          <Body style={styles.todayHeroSubtitle}>{t.subtitle}</Body>
        </View>

        <View style={styles.bigActionsGrid}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.countStock}
            style={styles.bigAction}
            onPress={() => router.push('/count')}
          >
            <View style={styles.bigActionIcon}>
              <Icon name="stock" size={22} colour={colours.primary} />
            </View>
            <Heading level={3}>{t.countStock}</Heading>
            <Small style={styles.bigActionHint}>{t.countStockHint}</Small>
          </Pressable>
          {canRecordWastage ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.recordWastage}
              style={styles.bigAction}
              onPress={() => setWasteSheetVisible(true)}
            >
              <View style={styles.bigActionIcon}>
                <Icon name="wastage" size={22} colour={colours.primary} />
              </View>
              <Heading level={3}>{t.recordWastage}</Heading>
              <Small style={styles.bigActionHint}>{t.recordWastageHint}</Small>
            </Pressable>
          ) : null}
        </View>

        {deadlineLabel ? (
          <View style={styles.deadlineCard}>
            <Icon name="clock" size={22} colour={colours.text} />
            <View style={styles.deadlineTextWrap}>
              <Body style={styles.deadlineTitle}>{deadlineLabel}</Body>
              {isHeadChef && today?.team_progress ? (
                <Small style={styles.deadlineSub}>
                  {t.teamProgress(today.team_progress.counted, today.team_progress.total)}
                </Small>
              ) : null}
            </View>
          </View>
        ) : null}

        <View>
          <Small style={styles.sectionLabel}>
            {isHeadChef ? t.entriesHeading : t.entriesHeadingMine}
          </Small>
          <Small style={styles.sectionSub}>{isHeadChef ? t.entriesSub : t.entriesSubMine}</Small>
          {loading ? (
            <SkeletonList count={2} height={60} />
          ) : wastage && wastage.results.length > 0 ? (
            <View style={styles.entryList}>
              {wastage.results.map((entry) => (
                <View key={entry.id} style={styles.entryRow}>
                  <View style={styles.entryIcon}>
                    <Icon name="wastage" size={20} colour={colours.primary} />
                  </View>
                  <View style={styles.entryMain}>
                    <Body style={styles.entryTitle}>
                      {entry.stock_item_name} · {entry.quantity} {entry.unit}
                    </Body>
                    <Small style={styles.entryMeta}>
                      {strings.wastageForm.reasons[entry.reason] ?? entry.reason} ·{' '}
                      {formatDateTime(entry.recorded_at, timezone)}
                    </Small>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Body style={styles.emptyText}>{t.entriesEmpty}</Body>
          )}
        </View>

        <Button
          label={s.logOut}
          variant="secondary"
          onPress={async () => {
            setLoggingOut(true);
            await logout();
          }}
          loading={loggingOut}
        />
      </Screen>

      <RecordWastageSheet
        visible={wasteSheetVisible}
        onClose={() => setWasteSheetVisible(false)}
        onSaved={() => {
          setWasteSheetVisible(false);
          setToast(strings.wastageForm.savedToast);
          load();
        }}
      />
      <Toast message={toast} onHide={() => setToast(null)} />
    </AppShell>
  );
}

/** Owner / Manager: the existing brand header + checklist, now with real Today cards (purchases,
 * stock count state, wastage entries — no sales card yet) and working quick actions. */
function OwnerHome() {
  const router = useRouter();
  const { user, businesses, authedFetch, refreshMe, logout } = useAuth();
  const business = businesses[0]!;
  const [loggingOut, setLoggingOut] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [purchaseSummary, setPurchaseSummary] = useState<PurchaseListResponse['summary'] | null>(
    null,
  );
  const [today, setToday] = useState<TodayStatus | null>(null);
  const [purchaseSheetVisible, setPurchaseSheetVisible] = useState(false);
  const [wasteSheetVisible, setWasteSheetVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const permissions = business.permissions;
  const canSeePurchases = can(permissions, 'purchases.view');
  const canRecordPurchase = can(permissions, 'purchases.create');
  const canRecordWastage = can(permissions, 'wastage.create');
  const canStartCount = can(permissions, 'counts.create');
  const timezone = business.timezone;

  const loadToday = useCallback(() => {
    if (canSeePurchases) {
      authedFetch<PurchaseListResponse>(`/businesses/${business.id}/purchases/`)
        .then((response) => setPurchaseSummary(response.summary))
        .catch(() => {});
    }
    authedFetch<TodayStatus>(`/businesses/${business.id}/today/`)
      .then(setToday)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.id, canSeePurchases]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  const isOwner = business.role === 'owner';
  const skippedSteps = business.skipped_steps;
  const checklistDismissed = Boolean(business.checklist_dismissed_at);
  const showChecklist = isOwner && skippedSteps.length > 0 && !checklistDismissed;

  // Presets already pass; a custom colour may have been darkened at save time — this just reads
  // whatever is stored, so it's correct either way without redoing that work here.
  const brandColour = ensureContrast(business.primary_colour).colour;
  const brandTextColour = bestTextOn(business.primary_colour);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
  }

  async function handleDismissChecklist() {
    setDismissing(true);
    try {
      await authedFetch(`/businesses/${business.id}/`, {
        method: 'PATCH',
        body: { dismiss_checklist: true },
      });
      await refreshMe();
    } finally {
      setDismissing(false);
    }
  }

  const closingLate = today?.closing.state === 'late';
  const openingLate = today?.opening.state === 'late';

  function countStateLine(
    type: 'opening' | 'closing',
    info: TodayStatus['opening'] | undefined,
  ): { icon: IconName; colour: string; label: string } {
    if (!info) return { icon: 'clock', colour: colours.muted, label: '' };
    if (info.state === 'done') {
      return {
        icon: 'success',
        colour: colours.success,
        label: type === 'opening' ? t.openingDone : t.closingDone,
      };
    }
    if (info.state === 'late') {
      return {
        icon: 'warning',
        colour: colours.warning,
        label: type === 'opening' ? t.openingLate : t.closingLate,
      };
    }
    const deadline = formatDateTime(info.deadline_at, timezone);
    return {
      icon: 'clock',
      colour: colours.muted,
      label: type === 'opening' ? t.openingDue(deadline) : t.closingDue(deadline),
    };
  }

  return (
    <AppShell active="home">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        {isOwner ? (
          <View style={[styles.brandHeader, { backgroundColor: brandColour }]}>
            <View style={styles.brandDecoration} />
            {business.logo ? <Image source={{ uri: business.logo }} style={styles.logo} /> : null}
            <Heading level={1} style={{ color: brandTextColour }}>
              {business.name}
            </Heading>
          </View>
        ) : (
          <View>
            <Heading level={1}>{s.greeting(user!.name)}</Heading>
            <Muted>{business.name}</Muted>
          </View>
        )}

        {showChecklist ? (
          <Card>
            <View style={styles.checklistHeader}>
              <Body style={styles.checklistTitle}>{s.checklistTitle}</Body>
              <Pressable
                accessibilityRole="button"
                onPress={handleDismissChecklist}
                disabled={dismissing}
              >
                <Small style={styles.dismissLink}>{s.dismissChecklist}</Small>
              </Pressable>
            </View>
            {skippedSteps.map((step) => (
              <View key={step} style={styles.checklistRow}>
                <Body style={styles.checklistStepTitle}>
                  {s.stepTitles[step] ?? `Step ${step}`}
                </Body>
                <Pressable accessibilityRole="button" onPress={() => router.push(`/setup/${step}`)}>
                  <Small style={styles.continueLink}>{s.continueStep}</Small>
                </Pressable>
              </View>
            ))}
          </Card>
        ) : null}

        {(closingLate || openingLate) && can(permissions, 'counts.review') ? (
          <View>
            <Small style={styles.sectionLabel}>{s.needsAttention}</Small>
            <Pressable
              accessibilityRole="button"
              style={styles.attentionCard}
              onPress={() => router.push('/counts')}
            >
              <View style={styles.attentionIcon}>
                <Icon name="clock" size={20} colour={colours.card} />
              </View>
              <View style={styles.entryMain}>
                <Body style={styles.attentionTitle}>{s.closingCountLateTitle}</Body>
                <Small style={styles.entryMeta}>
                  {closingLate
                    ? formatDateTime(today!.closing.deadline_at, timezone)
                    : formatDateTime(today!.opening.deadline_at, timezone)}
                </Small>
              </View>
              <Icon name="chevronRight" size={20} colour={colours.muted} />
            </Pressable>
          </View>
        ) : null}

        {canSeePurchases && purchaseSummary ? (
          <View style={styles.statRow}>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.boughtToday}</Small>
              <Heading level={3}>{formatRupees(purchaseSummary.bought_today)}</Heading>
            </Card>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.last7Days}</Small>
              <Heading level={3}>{formatRupees(purchaseSummary.last_7_days)}</Heading>
            </Card>
          </View>
        ) : null}

        {today ? (
          <View style={styles.statRow}>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.stockCountToday}</Small>
              {(['opening', 'closing'] as const).map((type) => {
                const line = countStateLine(type, today[type]);
                return (
                  <View key={type} style={styles.countStateRow}>
                    <Icon name={line.icon} size={16} colour={line.colour} />
                    <Small style={[styles.countStateLabel, { color: line.colour }]}>
                      {line.label}
                    </Small>
                  </View>
                );
              })}
            </Card>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.wastageToday}</Small>
              <Heading level={3}>{s.wastageEntriesCount(today.wastage_entries_today)}</Heading>
            </Card>
          </View>
        ) : null}

        <View>
          <Small style={styles.sectionLabel}>{s.quickActions}</Small>
          <View style={styles.actionsGrid}>
            {canRecordPurchase ? (
              <ActionCard
                label={s.recordPurchase}
                icon="buy"
                onPress={() => setPurchaseSheetVisible(true)}
              />
            ) : null}
            {canStartCount ? (
              <ActionCard
                label={s.startStockCount}
                icon="stock"
                onPress={() => router.push('/count')}
              />
            ) : null}
            {canRecordWastage ? (
              <ActionCard
                label={s.recordWastage}
                icon="wastage"
                onPress={() => setWasteSheetVisible(true)}
              />
            ) : null}
            <DisabledAction label={s.recordSales} />
          </View>
        </View>

        <Button
          label={s.logOut}
          variant="secondary"
          colour={brandColour}
          textColour={brandTextColour}
          onPress={handleLogout}
          loading={loggingOut}
        />
      </Screen>

      <RecordPurchaseSheet
        visible={purchaseSheetVisible}
        onClose={() => setPurchaseSheetVisible(false)}
        onSaved={() => {
          setPurchaseSheetVisible(false);
          setToast(strings.purchase.savedToast);
          loadToday();
        }}
      />
      <RecordWastageSheet
        visible={wasteSheetVisible}
        onClose={() => setWasteSheetVisible(false)}
        onSaved={() => {
          setWasteSheetVisible(false);
          setToast(strings.wastageForm.savedToast);
          loadToday();
        }}
      />
      <Toast message={toast} onHide={() => setToast(null)} />
    </AppShell>
  );
}

function ActionCard({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: 'buy' | 'stock' | 'wastage' | 'sales';
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" style={styles.actionCard} onPress={onPress}>
      <Icon name={icon} size={24} colour={colours.primary} />
      <Body style={styles.actionLabel}>{label}</Body>
    </Pressable>
  );
}

function DisabledAction({ label }: { label: string }) {
  return (
    <View style={[styles.actionCard, styles.actionCardDisabled]}>
      <Body style={styles.actionLabelDisabled}>{label}</Body>
      <Small style={styles.comingSoonBadge}>{strings.home.comingSoonBadge}</Small>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  brandHeader: {
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  // The prototype's bug: a decorative circle sat behind the subtitle with white text on orange,
  // unreadable. Fixed by shrinking the circle into a corner behind nothing but padding — no text
  // is ever layered on top of it.
  brandDecoration: {
    position: 'absolute',
    top: -30,
    right: -30,
    width: 90,
    height: 90,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: radii.sm,
  },
  checklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  checklistTitle: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: type.md,
  },
  dismissLink: {
    color: colours.muted,
    fontFamily: fonts.bodyExtraBold,
    textDecorationLine: 'underline',
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  checklistStepTitle: {
    flex: 1,
  },
  continueLink: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
    textDecorationLine: 'underline',
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  statCard: {
    flex: 1,
    gap: spacing.xs,
  },
  statLabel: {
    color: colours.muted,
  },
  countStateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  countStateLabel: {
    flex: 1,
    minWidth: 0,
  },
  sectionLabel: {
    color: colours.muted,
    marginBottom: spacing.xs,
    fontFamily: fonts.bodyExtraBold,
  },
  sectionSub: {
    color: colours.muted,
    marginBottom: spacing.sm,
  },
  attentionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.warning,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  attentionIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: colours.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attentionTitle: {
    fontFamily: fonts.bodyExtraBold,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  actionCard: {
    width: 150,
    minHeight: 88,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  actionCardDisabled: {
    backgroundColor: colours.mint,
  },
  actionLabel: {
    fontFamily: fonts.bodyExtraBold,
  },
  actionLabelDisabled: {
    fontFamily: fonts.bodyExtraBold,
    color: colours.muted,
  },
  comingSoonBadge: {
    color: colours.muted,
  },
  todayHero: {
    backgroundColor: colours.primary,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  todayHeroTitle: {
    color: colours.card,
  },
  todayHeroSubtitle: {
    color: colours.card,
    opacity: 0.92,
  },
  bigActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  bigAction: {
    flex: 1,
    minWidth: 150,
    minHeight: 120,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.lg,
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  bigActionIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colours.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigActionHint: {
    color: colours.muted,
  },
  deadlineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colours.highlight,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  deadlineTextWrap: {
    flex: 1,
  },
  deadlineTitle: {
    fontFamily: fonts.bodyExtraBold,
  },
  deadlineSub: {
    color: colours.text,
  },
  entryList: {
    gap: spacing.sm,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  entryIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colours.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryMain: {
    flex: 1,
    gap: 2,
  },
  entryTitle: {
    fontFamily: fonts.bodyExtraBold,
  },
  entryMeta: {
    color: colours.muted,
  },
  emptyText: {
    color: colours.muted,
  },
});
