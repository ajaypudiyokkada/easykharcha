import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';

import type { Alert, AlertListResponse } from '../src/api/alerts';
import type { PurchaseListResponse } from '../src/api/purchases';
import type { TodayStatus } from '../src/api/counts';
import type { SaleListResponse } from '../src/api/sales';
import type { LowStockListResponse, SellItem } from '../src/api/stock';
import type { WastageListResponse } from '../src/api/wastage';
import { useAuth } from '../src/auth/AuthContext';
import { can, isLimitedRole } from '../src/auth/permissions';
import { formatDateTime, formatQty, formatRupees } from '../src/format';
import { RecordPurchaseSheet } from '../src/screens/RecordPurchaseSheet';
import { RecordSalesSheet } from '../src/screens/RecordSalesSheet';
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
import { HOME_CONTENT_WIDTH, MIN_TOUCH_TARGET } from '../src/ui/constants';
import { colours, fonts, radii, spacing, type } from '../src/theme/tokens';

const s = strings.home;
const t = strings.today;

function alertIconFor(type: Alert['type']): IconName {
  switch (type) {
    case 'opening_late':
    case 'closing_late':
      return 'clock';
    case 'price_rise':
      return 'reports';
    case 'wastage_high':
      return 'wastage';
    case 'gap_flagged':
    default:
      return 'alert';
  }
}

/** One Today-card row (opening or closing): icon/colour/label for its current state, plus a
 * "done <time> by <name>" detail line once it's done. Shared by TodayHome and OwnerHome so both
 * read Step 23b's status the same way. */
function countRowInfo(
  kind: 'opening' | 'closing',
  info: TodayStatus['opening'] | TodayStatus['closing'] | undefined,
  timezone: string,
): { icon: IconName; colour: string; label: string; detail: string } {
  if (!info) return { icon: 'clock', colour: colours.muted, label: '', detail: '' };
  if (info.state === 'done') {
    return {
      icon: 'success',
      colour: colours.success,
      label: kind === 'opening' ? t.openingDone : t.closingDone,
      detail:
        info.done_at && info.by ? t.doneBy(formatDateTime(info.done_at, timezone), info.by) : '',
    };
  }
  if (info.state === 'locked') {
    return { icon: 'clock', colour: colours.muted, label: t.closingLocked, detail: '' };
  }
  if (info.state === 'late') {
    return {
      icon: 'warning',
      colour: colours.warning,
      label: kind === 'opening' ? t.openingLate : t.closingLate,
      detail: '',
    };
  }
  const due = 'due_by' in info ? info.due_by : info.due_from;
  return {
    icon: 'clock',
    colour: colours.muted,
    label:
      kind === 'opening'
        ? t.openingDue(formatDateTime(due, timezone))
        : t.closingDue(formatDateTime(due, timezone)),
    detail: '',
  };
}

function nextActionLabel(nextAction: TodayStatus['next_action'] | undefined): string | null {
  if (nextAction === 'opening') return t.startOpening;
  if (nextAction === 'closing') return t.startClosing;
  return null;
}

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
  const { user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];
  const canRecordWastage = can(permissions, 'wastage.create');
  const canSeeLowStock = can(permissions, 'stock.low_stock_view');
  const timezone = business?.timezone ?? 'Asia/Kolkata';

  const [today, setToday] = useState<TodayStatus | null>(null);
  const [wastage, setWastage] = useState<WastageListResponse | null>(null);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [wasteSheetVisible, setWasteSheetVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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
    if (canSeeLowStock) {
      authedFetch<LowStockListResponse>(`/businesses/${business.id}/stock/low-stock/`)
        .then((response) => setLowStockCount(response.results.length))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business, authedFetch, canSeeLowStock]);

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

  const isHeadChef = can(permissions, 'counts.status');
  const startLabel = nextActionLabel(today?.next_action);

  return (
    <AppShell active="home">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <View style={styles.todayHero}>
          <Heading level={1} style={styles.todayHeroTitle}>
            {t.greeting(user.name)}
          </Heading>
          <Body style={styles.todayHeroSubtitle}>{t.subtitle}</Body>
        </View>

        <Card style={styles.todayCountCard}>
          {(['opening', 'closing'] as const).map((kind) => {
            const row = countRowInfo(kind, today?.[kind], timezone);
            return (
              <View key={kind} style={styles.countStateRow}>
                <Icon name={row.icon} size={18} colour={row.colour} />
                <View style={styles.countStateTextWrap}>
                  <Body style={[styles.deadlineTitle, { color: row.colour }]}>{row.label}</Body>
                  {row.detail ? <Small style={styles.deadlineSub}>{row.detail}</Small> : null}
                </View>
              </View>
            );
          })}
          {isHeadChef && today?.team_progress ? (
            <Small style={styles.deadlineSub}>
              {t.teamProgress(today.team_progress.counted, today.team_progress.total)}
            </Small>
          ) : null}
          {startLabel ? (
            <Button label={startLabel} variant="primary" onPress={() => router.push('/count')} />
          ) : (
            <Small style={styles.deadlineSub}>{t.bothDoneTitle}</Small>
          )}
        </Card>

        {canSeeLowStock && lowStockCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            style={styles.setupCard}
            onPress={() => router.push('/stock/low-stock')}
          >
            <View style={styles.setupIcon}>
              <Icon name="alert" size={20} colour={colours.card} />
            </View>
            <View style={styles.entryMain}>
              <Body style={styles.attentionTitle}>{s.lowStockTitle(lowStockCount)}</Body>
              <Small style={styles.entryMeta}>{s.lowStockBody}</Small>
            </View>
            <Icon name="chevronRight" size={20} colour={colours.muted} />
          </Pressable>
        ) : null}

        {canRecordWastage ? (
          <View style={styles.bigActionsGrid}>
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
                      {entry.stock_item_name} ·{' '}
                      {formatQty(entry.quantity, entry.unit, {
                        quantity: entry.display_quantity,
                        unit: entry.display_unit,
                      })}
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
 * stock count state, wastage entries, sales) and working quick actions. */
function OwnerHome() {
  const router = useRouter();
  const { user, businesses, authedFetch, refreshMe } = useAuth();
  const business = businesses[0]!;
  const [dismissing, setDismissing] = useState(false);
  const [purchaseSummary, setPurchaseSummary] = useState<PurchaseListResponse['summary'] | null>(
    null,
  );
  const [salesSummary, setSalesSummary] = useState<SaleListResponse['summary'] | null>(null);
  const [needsIngredientsCount, setNeedsIngredientsCount] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [today, setToday] = useState<TodayStatus | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [purchaseSheetVisible, setPurchaseSheetVisible] = useState(false);
  const [wasteSheetVisible, setWasteSheetVisible] = useState(false);
  const [salesSheetVisible, setSalesSheetVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const permissions = business.permissions;
  const canSeePurchases = can(permissions, 'purchases.view');
  const canRecordPurchase = can(permissions, 'purchases.create');
  const canRecordWastage = can(permissions, 'wastage.create');
  const canStartCount = can(permissions, 'counts.create');
  const canSeeSales = can(permissions, 'sales.view');
  const canRecordSales = can(permissions, 'sales.create');
  const canSeeAlerts = can(permissions, 'alerts.view');
  const canSeeLowStock = can(permissions, 'stock.low_stock_view');
  const timezone = business.timezone;
  const isOwner = business.role === 'owner';

  const loadToday = useCallback(() => {
    if (canSeePurchases) {
      authedFetch<PurchaseListResponse>(`/businesses/${business.id}/purchases/`)
        .then((response) => setPurchaseSummary(response.summary))
        .catch(() => {});
    }
    if (canSeeSales) {
      const today_ = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
      authedFetch<SaleListResponse>(
        `/businesses/${business.id}/sales/?date_from=${today_}&date_to=${today_}`,
      )
        .then((response) => setSalesSummary(response.summary))
        .catch(() => {});
    }
    if (isOwner) {
      authedFetch<SellItem[]>(`/businesses/${business.id}/sell-items/`)
        .then((items) =>
          setNeedsIngredientsCount(
            items.filter((item) => item.recipe_status !== 'confirmed').length,
          ),
        )
        .catch(() => {});
    }
    if (canSeeAlerts) {
      authedFetch<AlertListResponse>(`/businesses/${business.id}/alerts/`)
        .then((response) => setAlerts(response.results))
        .catch(() => {});
    }
    if (canSeeLowStock) {
      authedFetch<LowStockListResponse>(`/businesses/${business.id}/stock/low-stock/`)
        .then((response) => setLowStockCount(response.results.length))
        .catch(() => {});
    }
    authedFetch<TodayStatus>(`/businesses/${business.id}/today/`)
      .then(setToday)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.id, canSeePurchases, canSeeSales, canSeeAlerts, canSeeLowStock, isOwner, timezone]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  const skippedSteps = business.skipped_steps;
  const checklistDismissed = Boolean(business.checklist_dismissed_at);
  const showChecklist = isOwner && skippedSteps.length > 0 && !checklistDismissed;

  // Presets already pass; a custom colour may have been darkened at save time — this just reads
  // whatever is stored, so it's correct either way without redoing that work here.
  const brandColour = ensureContrast(business.primary_colour).colour;
  const brandTextColour = bestTextOn(business.primary_colour);

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

  const startLabel = nextActionLabel(today?.next_action);

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

        {canSeeAlerts && alerts && alerts.length > 0 ? (
          <View>
            <Small style={styles.sectionLabel}>{s.needsAttention}</Small>
            <Small style={styles.sectionSub}>{s.needsAttentionSubtitle}</Small>
            <View style={styles.entryList}>
              {alerts.slice(0, 4).map((alert) => (
                <Pressable
                  key={alert.key}
                  accessibilityRole="button"
                  accessibilityLabel={alert.title}
                  style={styles.attentionCard}
                  onPress={() =>
                    router.push({ pathname: '/alerts/[key]', params: { key: alert.key } })
                  }
                >
                  <View
                    style={[
                      styles.attentionIcon,
                      {
                        backgroundColor:
                          alert.severity === 'danger' ? colours.danger : colours.warning,
                      },
                    ]}
                  >
                    <Icon name={alertIconFor(alert.type)} size={20} colour={colours.card} />
                  </View>
                  <View style={styles.entryMain}>
                    <Body style={styles.attentionTitle}>{alert.title}</Body>
                    <Small style={styles.entryMeta}>{alert.detail}</Small>
                  </View>
                  <Icon name="chevronRight" size={20} colour={colours.muted} />
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              style={styles.allAlertsLink}
              onPress={() => router.push('/alerts')}
            >
              <Small style={styles.continueLink}>{s.allAlerts}</Small>
            </Pressable>
          </View>
        ) : null}

        {isOwner && today?.is_first_count ? (
          <Pressable
            accessibilityRole="button"
            style={styles.setupCard}
            onPress={() => router.push('/count')}
          >
            <View style={styles.setupIcon}>
              <Icon name="info" size={20} colour={colours.card} />
            </View>
            <View style={styles.entryMain}>
              <Body style={styles.attentionTitle}>{s.firstCountTitle}</Body>
              <Small style={styles.entryMeta}>{s.firstCountBody}</Small>
            </View>
            <Icon name="chevronRight" size={20} colour={colours.muted} />
          </Pressable>
        ) : null}

        {isOwner && needsIngredientsCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            style={styles.setupCard}
            onPress={() => router.push('/settings/sell?filter=needs_ingredients')}
          >
            <View style={styles.setupIcon}>
              <Icon name="info" size={20} colour={colours.card} />
            </View>
            <View style={styles.entryMain}>
              <Body style={styles.attentionTitle}>
                {s.needsIngredientsTitle(needsIngredientsCount)}
              </Body>
              <Small style={styles.entryMeta}>{s.needsIngredientsBody}</Small>
            </View>
            <Icon name="chevronRight" size={20} colour={colours.muted} />
          </Pressable>
        ) : null}

        {canSeeLowStock && lowStockCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            style={styles.setupCard}
            onPress={() => router.push('/stock/low-stock')}
          >
            <View style={styles.setupIcon}>
              <Icon name="alert" size={20} colour={colours.card} />
            </View>
            <View style={styles.entryMain}>
              <Body style={styles.attentionTitle}>{s.lowStockTitle(lowStockCount)}</Body>
              <Small style={styles.entryMeta}>{s.lowStockBody}</Small>
            </View>
            <Icon name="chevronRight" size={20} colour={colours.muted} />
          </Pressable>
        ) : null}

        {(canSeePurchases && purchaseSummary) || (canSeeSales && salesSummary) ? (
          <View>
            <Small style={styles.sectionLabel}>{s.moneyToday}</Small>
            <View style={styles.statRow}>
              {canSeePurchases && purchaseSummary ? (
                <Card style={styles.statCard}>
                  <Small style={styles.statLabel}>{s.boughtToday}</Small>
                  <Heading level={3}>{formatRupees(purchaseSummary.bought_today)}</Heading>
                </Card>
              ) : null}
              {canSeeSales && salesSummary ? (
                <Card style={styles.statCard}>
                  <Small style={styles.statLabel}>{s.salesToday}</Small>
                  <Heading level={3}>{formatRupees(salesSummary.sales_today)}</Heading>
                </Card>
              ) : null}
              {canSeePurchases && purchaseSummary ? (
                <Card style={styles.statCard}>
                  <Small style={styles.statLabel}>{s.last7Days}</Small>
                  <Heading level={3}>{formatRupees(purchaseSummary.last_7_days)}</Heading>
                </Card>
              ) : null}
            </View>
            {can(permissions, 'reports.view') ? (
              <Pressable
                accessibilityRole="button"
                style={styles.allAlertsLink}
                onPress={() =>
                  router.push('/reports?period=7d' as Parameters<typeof router.push>[0])
                }
              >
                <Small style={styles.continueLink}>{s.reportsLink}</Small>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {today ? (
          <View style={styles.statRow}>
            <Card style={styles.ownerTodayCountCard}>
              <Small style={styles.statLabel}>{s.stockCountToday}</Small>
              {(['opening', 'closing'] as const).map((kind) => {
                const row = countRowInfo(kind, today[kind], timezone);
                return (
                  <View key={kind} style={styles.countStateRow}>
                    <Icon name={row.icon} size={16} colour={row.colour} />
                    <View style={styles.countStateTextWrap}>
                      <Small style={[styles.countStateLabel, { color: row.colour }]}>
                        {row.label}
                      </Small>
                      {row.detail ? <Small style={styles.deadlineSub}>{row.detail}</Small> : null}
                    </View>
                  </View>
                );
              })}
              {canStartCount && startLabel ? (
                <Button
                  label={startLabel}
                  variant="primary"
                  onPress={() => router.push('/count')}
                />
              ) : null}
            </Card>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.wastageToday}</Small>
              <Heading level={3}>{s.wastageEntriesCount(today.wastage_entries_today)}</Heading>
            </Card>
          </View>
        ) : null}

        {canSeeSales && salesSummary ? (
          <Card>
            <Small style={styles.statLabel}>{strings.sales.title}</Small>
            <Heading level={3}>{s.itemsSoldToday(salesSummary.items_sold_today)}</Heading>
          </Card>
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
            {canRecordSales ? (
              <ActionCard
                label={s.recordSales}
                icon="sales"
                onPress={() => setSalesSheetVisible(true)}
              />
            ) : null}
          </View>
        </View>
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
      <RecordSalesSheet
        visible={salesSheetVisible}
        onClose={() => setSalesSheetVisible(false)}
        onSaved={() => {
          setSalesSheetVisible(false);
          setToast(strings.salesForm.savedToast);
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
  allAlertsLink: {
    alignSelf: 'flex-start',
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
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
  todayCountCard: {
    gap: spacing.sm,
  },
  ownerTodayCountCard: {
    flex: 1,
    gap: spacing.sm,
  },
  countStateTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
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
  setupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.primary,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  setupIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: colours.primary,
    alignItems: 'center',
    justifyContent: 'center',
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
