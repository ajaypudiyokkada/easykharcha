import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';

import type { PurchaseListResponse } from '../src/api/purchases';
import { useAuth } from '../src/auth/AuthContext';
import { can } from '../src/auth/permissions';
import { formatRupees } from '../src/format';
import { RecordPurchaseSheet } from '../src/screens/RecordPurchaseSheet';
import { bestTextOn, ensureContrast } from '../src/theme/brand';
import { strings } from '../src/strings';
import { Body, Button, Card, Heading, Icon, Muted, Screen, Small, Toast } from '../src/ui';
import { AppShell } from '../src/ui/AppShell';
import { HOME_CONTENT_WIDTH } from '../src/ui/constants';
import { colours, fonts, radii, spacing, type } from '../src/theme/tokens';

const s = strings.home;

export default function Home() {
  const router = useRouter();
  const { status, user, businesses, authedFetch, refreshMe, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [summary, setSummary] = useState<PurchaseListResponse['summary'] | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const business = businesses[0];
  const permissions = business?.permissions ?? [];
  const canSeePurchases = can(permissions, 'purchases.view');
  const canRecordPurchase = can(permissions, 'purchases.create');
  const isPlaceholderRole = permissions.length === 0;

  useEffect(() => {
    if (!business || !canSeePurchases) return;
    authedFetch<PurchaseListResponse>(`/businesses/${business.id}/purchases/`)
      .then((response) => setSummary(response.summary))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, canSeePurchases]);

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

  const isOwner = business?.role === 'owner';
  const skippedSteps = business?.skipped_steps ?? [];
  const checklistDismissed = Boolean(business?.checklist_dismissed_at);
  const showChecklist = isOwner && skippedSteps.length > 0 && !checklistDismissed;

  // Presets already pass; a custom colour may have been darkened at save time — this just reads
  // whatever is stored, so it's correct either way without redoing that work here.
  const brandColour = business ? ensureContrast(business.primary_colour).colour : undefined;
  const brandTextColour = business ? bestTextOn(business.primary_colour) : undefined;

  async function handleLogout() {
    setLoggingOut(true);
    // No explicit navigation here — logout() flips `status` to 'signedOut', and the Redirect
    // above reacts to that. (An explicit router.replace alongside a reactive Redirect raced
    // against each other the last time this pattern was tried.)
    await logout();
  }

  async function handleDismissChecklist() {
    if (!business) return;
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

  if (isPlaceholderRole) {
    return (
      <AppShell active="home">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <Heading level={1}>{s.greeting(user.name)}</Heading>
          <Body style={styles.placeholderBody}>{s.placeholderMessage}</Body>
          <Button
            label={s.logOut}
            variant="secondary"
            onPress={handleLogout}
            loading={loggingOut}
          />
        </Screen>
      </AppShell>
    );
  }

  return (
    <AppShell active="home">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        {isOwner && business ? (
          <View style={[styles.brandHeader, { backgroundColor: brandColour }]}>
            <View style={styles.brandDecoration} />
            {business.logo ? <Image source={{ uri: business.logo }} style={styles.logo} /> : null}
            <Heading level={1} style={{ color: brandTextColour }}>
              {business.name}
            </Heading>
          </View>
        ) : (
          <View>
            <Heading level={1}>{s.greeting(user.name)}</Heading>
            {business ? <Muted>{business.name}</Muted> : null}
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

        {canSeePurchases && summary ? (
          <View style={styles.statRow}>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.boughtToday}</Small>
              <Heading level={3}>{formatRupees(summary.bought_today)}</Heading>
            </Card>
            <Card style={styles.statCard}>
              <Small style={styles.statLabel}>{s.last7Days}</Small>
              <Heading level={3}>{formatRupees(summary.last_7_days)}</Heading>
            </Card>
          </View>
        ) : null}

        <View>
          <Small style={styles.sectionLabel}>{s.quickActions}</Small>
          <View style={styles.actionsGrid}>
            {canRecordPurchase ? (
              <Pressable
                accessibilityRole="button"
                style={styles.actionCard}
                onPress={() => setSheetVisible(true)}
              >
                <Icon name="buy" size={24} colour={colours.primary} />
                <Body style={styles.actionLabel}>{s.recordPurchase}</Body>
              </Pressable>
            ) : null}
            <DisabledAction label={s.startStockCount} />
            <DisabledAction label={s.recordWastage} />
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
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        onSaved={() => {
          setSheetVisible(false);
          setToast(strings.purchase.savedToast);
          if (business) {
            authedFetch<PurchaseListResponse>(`/businesses/${business.id}/purchases/`)
              .then((response) => setSummary(response.summary))
              .catch(() => {});
          }
        }}
      />
      <Toast message={toast} onHide={() => setToast(null)} />
    </AppShell>
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
  placeholderBody: {
    color: colours.muted,
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
  sectionLabel: {
    color: colours.muted,
    marginBottom: spacing.sm,
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
});
