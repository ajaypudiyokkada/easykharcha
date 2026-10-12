import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { SellItem, StockItem } from '../../src/api/stock';
import type { TeamMember } from '../../src/api/team';
import { ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { getOnboardingBusiness } from '../../src/business/routing';
import { strings } from '../../src/strings';
import { Banner, Body, Button, Heading, Icon, Muted, Screen, Small } from '../../src/ui';
import { colours, fonts, spacing, type } from '../../src/theme/tokens';

const s = strings.setup.done;
const stepTitles = strings.home.stepTitles;

type Counts = { stock: number; sell: number; team: number };

export default function SetupDone() {
  const router = useRouter();
  const { status, businesses, authedFetch, refreshMe } = useAuth();
  const onboardingBusiness = getOnboardingBusiness(businesses);
  const [businessId] = useState(() => onboardingBusiness?.id);
  const business = businesses.find((b) => b.id === businessId) ?? onboardingBusiness;

  const [counts, setCounts] = useState<Counts | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    (async () => {
      try {
        await authedFetch(`/businesses/${businessId}/onboarding/complete/`, { method: 'POST' });
        await refreshMe();
      } catch (err) {
        setCompleteError(err instanceof ApiError ? err.message : 'Could not finish setup.');
      }
      try {
        const [stockItems, sellItems, team] = await Promise.all([
          authedFetch<StockItem[]>(`/businesses/${businessId}/stock-items/`),
          authedFetch<SellItem[]>(`/businesses/${businessId}/sell-items/`),
          authedFetch<TeamMember[]>(`/businesses/${businessId}/team/`),
        ]);
        setCounts({
          stock: stockItems.length,
          sell: sellItems.length,
          team: team.filter((member) => member.role !== 'owner').length,
        });
      } catch {
        setCounts({ stock: 0, sell: 0, team: 0 });
      }
    })();
    // Runs once for the business this screen is finishing onboarding for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  if (status === 'bootstrapping') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }
  if (status === 'signedOut') {
    return <Redirect href="/login" />;
  }
  if (!business) {
    return <Redirect href="/home" />;
  }

  const skippedSteps = business.skipped_steps.map((step) => stepTitles[step] ?? `Step ${step}`);

  return (
    <Screen>
      <Heading level={1}>{s.title}</Heading>

      {completeError ? <Banner kind="error">{completeError}</Banner> : null}

      {counts ? (
        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <Icon name="success" size={type.md} colour={colours.success} />
            <Body>{s.stockItemsCount(counts.stock)}</Body>
          </View>
          <View style={styles.summaryRow}>
            <Icon name="success" size={type.md} colour={colours.success} />
            <Body>{s.sellItemsCount(counts.sell)}</Body>
          </View>
          <View style={styles.summaryRow}>
            <Icon name="success" size={type.md} colour={colours.success} />
            <Body>{s.teamCount(counts.team)}</Body>
          </View>
        </View>
      ) : (
        <ActivityIndicator color={colours.primary} />
      )}

      {skippedSteps.length > 0 ? (
        <View style={styles.field}>
          <Small style={styles.stillToDoLabel}>{s.stillToDo}</Small>
          {skippedSteps.map((title) => (
            <View key={title} style={styles.summaryRow}>
              <Icon name="warning" size={type.md} colour={colours.warning} />
              <Body>{title}</Body>
            </View>
          ))}
        </View>
      ) : null}

      <Button label={s.goHome} variant="primary" onPress={() => router.replace('/home')} />

      <View style={styles.field}>
        <Button label={s.addOpeningStock} variant="secondary" disabled onPress={() => {}} />
        <Muted size="sm">{s.comingSoon}</Muted>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  summary: {
    gap: spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  field: {
    gap: spacing.sm,
  },
  stillToDoLabel: {
    fontFamily: fonts.bodyExtraBold,
    color: colours.muted,
  },
});
