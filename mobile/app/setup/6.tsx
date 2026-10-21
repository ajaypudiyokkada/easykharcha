import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { BusinessSettings } from '../../src/api/business';
import { ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { getOnboardingBusiness } from '../../src/business/routing';
import { DEFAULT_BUSINESS_SETTINGS } from '../../src/constants/businessSettings';
import { targetCostHint } from '../../src/sectorCopy';
import { strings } from '../../src/strings';
import { BottomActionBar, Body, Button, Icon, Screen, StepHeader, TextField } from '../../src/ui';
import { WIZARD_CONTENT_WIDTH } from '../../src/ui/constants';
import { colours, fonts, spacing, type } from '../../src/theme/tokens';

const s = strings.setup;
const s6 = strings.setup.step6;

export default function SetupStepSix() {
  const router = useRouter();
  const { status, businesses, authedFetch, refreshMe } = useAuth();
  const onboardingBusiness = getOnboardingBusiness(businesses);

  const [countDeadlineHour, setCountDeadlineHour] = useState(
    String(DEFAULT_BUSINESS_SETTINGS.count_deadline_hour),
  );
  const [targetCostPct, setTargetCostPct] = useState(
    String(DEFAULT_BUSINESS_SETTINGS.target_cost_pct),
  );
  const [wastageAlertPct, setWastageAlertPct] = useState(
    String(DEFAULT_BUSINESS_SETTINGS.wastage_alert_pct),
  );
  const [rateCreepPct, setRateCreepPct] = useState(
    String(DEFAULT_BUSINESS_SETTINGS.rate_creep_pct),
  );

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [usingRecommended, setUsingRecommended] = useState(false);
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    if (!onboardingBusiness) return;
    authedFetch<BusinessSettings>(`/businesses/${onboardingBusiness.id}/settings/`)
      .then((settings) => {
        setCountDeadlineHour(String(settings.count_deadline_hour));
        setTargetCostPct(settings.target_cost_pct);
        setWastageAlertPct(settings.wastage_alert_pct);
        setRateCreepPct(settings.rate_creep_pct);
      })
      .catch(() => {
        // Keep the recommended defaults already in state — this is only a pre-fill.
      });
    // Fetches once for the business this screen is onboarding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingBusiness?.id]);

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
  if (!onboardingBusiness) {
    return <Redirect href="/setup/1" />;
  }
  const business = onboardingBusiness;

  function mapSubmitError(err: unknown) {
    if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
      setSubmitError(s6.errors.network);
    } else if (err instanceof ApiError) {
      setSubmitError(err.message || s6.errors.generic);
    } else {
      setSubmitError(s6.errors.generic);
    }
  }

  async function markStepDone() {
    await authedFetch(`/businesses/${business.id}/onboarding/6/`, {
      method: 'PATCH',
      body: { status: 'done' },
    });
    await refreshMe();
  }

  async function handleUseRecommended() {
    setSubmitError(null);
    setUsingRecommended(true);
    try {
      await authedFetch(`/businesses/${business.id}/settings/`, {
        method: 'PATCH',
        body: DEFAULT_BUSINESS_SETTINGS,
      });
      await markStepDone();
      router.push('/setup/done');
    } catch (err) {
      mapSubmitError(err);
    } finally {
      setUsingRecommended(false);
    }
  }

  async function save(): Promise<boolean> {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await authedFetch(`/businesses/${business.id}/settings/`, {
        method: 'PATCH',
        body: {
          count_deadline_hour: Number(countDeadlineHour),
          target_cost_pct: targetCostPct,
          wastage_alert_pct: wastageAlertPct,
          rate_creep_pct: rateCreepPct,
        },
      });
      await markStepDone();
      return true;
    } catch (err) {
      mapSubmitError(err);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNext() {
    if (await save()) router.push('/setup/done');
  }

  async function handleSaveForLater() {
    if (await save()) router.replace('/home');
  }

  async function handleSkip() {
    setSubmitError(null);
    setSkipping(true);
    try {
      await authedFetch(`/businesses/${business.id}/onboarding/6/`, {
        method: 'PATCH',
        body: { status: 'skipped' },
      });
      await refreshMe();
      router.push('/setup/done');
    } catch (err) {
      mapSubmitError(err);
    } finally {
      setSkipping(false);
    }
  }

  return (
    <Screen
      maxWidth={WIZARD_CONTENT_WIDTH}
      bottomBar={
        <BottomActionBar
          primaryLabel={s.next}
          onPrimaryPress={handleNext}
          primaryLoading={submitting}
          primaryDisabled={skipping || usingRecommended}
          skipLabel={s.skipForNow}
          onSkipPress={handleSkip}
        />
      }
    >
      <StepHeader
        current={6}
        total={s.totalSteps}
        onBack={() => router.push('/setup/5')}
        onSaveForLater={handleSaveForLater}
      />

      <Body style={styles.title}>{s6.title}</Body>

      {submitError ? (
        <View style={styles.formError}>
          <Icon name="error" size={type.md} colour={colours.danger} />
          <Body style={styles.formErrorText}>{submitError}</Body>
        </View>
      ) : null}

      <Button
        label={s6.useRecommended}
        variant="primary"
        onPress={handleUseRecommended}
        loading={usingRecommended}
        disabled={submitting || skipping}
      />

      <Body style={styles.sectionLabel}>{s6.orEditTitle}</Body>

      <TextField
        label={s6.countDeadlineLabel}
        value={countDeadlineHour}
        onChangeText={setCountDeadlineHour}
        keyboardType="number-pad"
        hint={s6.countDeadlineExample}
      />
      <TextField
        label={s6.targetCostLabel}
        value={targetCostPct}
        onChangeText={setTargetCostPct}
        keyboardType="decimal-pad"
        hint={targetCostHint(business.business_type)}
      />
      <TextField
        label={s6.wastageAlertLabel}
        value={wastageAlertPct}
        onChangeText={setWastageAlertPct}
        keyboardType="decimal-pad"
        hint={s6.wastageAlertExample}
      />
      <TextField
        label={s6.rateRiseLabel}
        value={rateCreepPct}
        onChangeText={setRateCreepPct}
        keyboardType="decimal-pad"
        hint={s6.rateRiseExample}
      />
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
  sectionLabel: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: type.md,
  },
  formError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  formErrorText: {
    flex: 1,
    color: colours.danger,
    fontFamily: fonts.bodyExtraBold,
  },
});
