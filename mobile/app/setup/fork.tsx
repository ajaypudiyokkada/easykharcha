import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { Business } from '../../src/api/business';
import { useAuth } from '../../src/auth/AuthContext';
import { getOnboardingBusiness } from '../../src/business/routing';
import { sectorCopyFor } from '../../src/sectorCopy';
import { strings } from '../../src/strings';
import { Body, Icon, Screen, Small, StepHeader } from '../../src/ui';
import { WIZARD_CONTENT_WIDTH } from '../../src/ui/constants';
import { colours, fonts, radii, spacing, type } from '../../src/theme/tokens';

const s = strings.setup;
const sf = strings.setup.fork;

export default function SetupFork() {
  const router = useRouter();
  const { status, businesses, authedFetch, refreshMe } = useAuth();
  const business = getOnboardingBusiness(businesses);
  const [saving, setSaving] = useState<'quick' | 'diy' | null>(null);

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
    return <Redirect href="/setup/1" />;
  }

  const sector = sectorCopyFor(business.business_type);
  // This fork only exists for sectors that offer a menu scan — a direct link or a stale bookmark
  // for any other sector just skips straight to the next real step.
  if (!sector.menuScanEnabled) {
    return <Redirect href="/setup/2" />;
  }

  async function choose(path: 'quick' | 'diy') {
    setSaving(path);
    try {
      await authedFetch<Business>(`/businesses/${business!.id}/`, {
        method: 'PATCH',
        body: { onboarding_path: path },
      });
      await refreshMe();
      if (path === 'quick') {
        router.push(`/menu-scan?businessId=${business!.id}&returnTo=onboarding`);
      } else {
        router.push('/setup/2');
      }
    } finally {
      setSaving(null);
    }
  }

  return (
    <Screen maxWidth={WIZARD_CONTENT_WIDTH}>
      <StepHeader
        current={1}
        total={s.totalSteps}
        onBack={() => router.push('/setup/1')}
        onSaveForLater={() => router.replace('/home')}
      />

      <Body style={styles.title}>{sf.title}</Body>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={sf.quickTitle}
        onPress={() => choose('quick')}
        disabled={saving !== null}
        style={styles.choiceCard}
      >
        <Icon name="scan" size={28} colour={colours.primary} />
        <View style={styles.choiceCopy}>
          <View style={styles.choiceTitleRow}>
            <Body style={styles.choiceTitle}>{sf.quickTitle}</Body>
            <View style={styles.recommendedBadge}>
              <Small style={styles.recommendedText}>{sf.recommended}</Small>
            </View>
          </View>
          <Small style={styles.choiceSubtitle}>{sf.quickSubtitle(sector.menuNoun)}</Small>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={sf.diyTitle}
        onPress={() => choose('diy')}
        disabled={saving !== null}
        style={styles.choiceCard}
      >
        <Icon name="edit" size={28} colour={colours.primary} />
        <View style={styles.choiceCopy}>
          <Body style={styles.choiceTitle}>{sf.diyTitle}</Body>
          <Small style={styles.choiceSubtitle}>{sf.diySubtitle}</Small>
        </View>
      </Pressable>

      {saving ? (
        <View style={styles.savingRow}>
          <ActivityIndicator color={colours.primary} />
        </View>
      ) : null}
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
  title: {
    fontFamily: fonts.headingBold,
    fontSize: type.xl,
  },
  choiceCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  choiceCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  choiceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  choiceTitle: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: type.md,
  },
  choiceSubtitle: {
    color: colours.muted,
  },
  recommendedBadge: {
    backgroundColor: colours.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  recommendedText: {
    color: colours.card,
    fontFamily: fonts.bodyExtraBold,
  },
  savingRow: {
    alignItems: 'center',
  },
});
