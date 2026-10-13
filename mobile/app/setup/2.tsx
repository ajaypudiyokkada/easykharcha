import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

import type { Business } from '../../src/api/business';
import { ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { getOnboardingBusiness } from '../../src/business/routing';
import { BrandForm } from '../../src/forms/BrandForm';
import { strings } from '../../src/strings';
import { bestTextOn } from '../../src/theme/brand';
import { BottomActionBar, Body, Icon, Muted, Screen, StepHeader } from '../../src/ui';
import { WIZARD_CONTENT_WIDTH } from '../../src/ui/constants';
import { colours, fonts, radii, spacing, type } from '../../src/theme/tokens';

const s = strings.setup;
const s2 = strings.setup.step2;

export default function SetupStepTwo() {
  const router = useRouter();
  const { status, businesses, authedFetch, refreshMe } = useAuth();
  const existing = getOnboardingBusiness(businesses);

  const [colour, setColour] = useState(existing?.primary_colour ?? '#1F6F63');
  const [logoUri, setLogoUri] = useState<string | undefined>(existing?.logo ?? undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
  if (!existing) {
    return <Redirect href="/setup/1" />;
  }
  // A plain `const` so the functions below (called later, asynchronously) keep TypeScript's
  // non-null narrowing — `existing` itself loses it once captured in a closure.
  const business = existing;

  function mapError(err: unknown, fallback: string) {
    if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
      setFormError(s2.errors.network);
    } else if (err instanceof ApiError) {
      setFormError(err.message || fallback);
    } else {
      setFormError(fallback);
    }
  }

  async function save(nextStep: number): Promise<boolean> {
    setFormError(null);
    setSubmitting(true);
    try {
      await authedFetch<Business>(`/businesses/${business.id}/`, {
        method: 'PATCH',
        body: { primary_colour: colour, onboarding_step: nextStep },
      });
      await authedFetch(`/businesses/${business.id}/onboarding/2/`, {
        method: 'PATCH',
        body: { status: 'done' },
      });
      await refreshMe();
      return true;
    } catch (err) {
      mapError(err, s2.errors.generic);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNext() {
    if (await save(3)) router.push('/setup/3');
  }

  async function handleSaveForLater() {
    if (await save(3)) router.replace('/home');
  }

  const previewTextColour = bestTextOn(colour);

  const preview = (
    <View style={styles.field}>
      <Body style={styles.label}>{s2.previewLabel}</Body>
      <View style={styles.phone}>
        <View style={[styles.phoneHeader, { backgroundColor: colour }]}>
          {logoUri ? (
            <Image source={{ uri: logoUri }} style={styles.phoneLogo} />
          ) : (
            <View style={styles.phoneLogoPlaceholder} />
          )}
          <Body style={[styles.phoneName, { color: previewTextColour }]}>{existing.name}</Body>
        </View>
        <View style={styles.phoneBody}>
          <Muted size="sm">Today&rsquo;s stock</Muted>
        </View>
      </View>
    </View>
  );

  return (
    <Screen
      maxWidth={WIZARD_CONTENT_WIDTH}
      aside={preview}
      bottomBar={
        <BottomActionBar
          primaryLabel={s.next}
          onPrimaryPress={handleNext}
          primaryLoading={submitting}
        />
      }
    >
      <StepHeader
        current={2}
        total={s.totalSteps}
        onBack={() => router.push('/setup/1')}
        onSaveForLater={handleSaveForLater}
      />

      <Body style={styles.title}>{s2.title}</Body>

      {formError ? (
        <View style={styles.formError}>
          <Icon name="error" size={type.md} colour={colours.danger} />
          <Body style={styles.formErrorText}>{formError}</Body>
        </View>
      ) : null}

      <BrandForm
        business={business}
        authedFetch={authedFetch}
        colour={colour}
        onColourChange={setColour}
        logoUri={logoUri}
        onLogoChange={setLogoUri}
        onError={(message) => setFormError(message)}
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
  field: {
    gap: spacing.sm,
  },
  label: {
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
  phone: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colours.card,
  },
  phoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  phoneLogo: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
  },
  phoneLogoPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  phoneName: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: type.md,
  },
  phoneBody: {
    padding: spacing.lg,
  },
});
