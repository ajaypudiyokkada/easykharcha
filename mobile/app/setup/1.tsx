import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { Business } from '../../src/api/business';
import { ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { getOnboardingBusiness } from '../../src/business/routing';
import { BusinessForm, type BusinessDraft } from '../../src/forms/BusinessForm';
import { strings } from '../../src/strings';
import { BottomActionBar, Body, Icon, Screen, StepHeader } from '../../src/ui';
import { WIZARD_CONTENT_WIDTH } from '../../src/ui/constants';
import { colours, fonts, spacing, type } from '../../src/theme/tokens';

const s = strings.setup;
const s1 = strings.setup.step1;

type FieldErrors = {
  name?: string;
  businessType?: string;
  city?: string;
};

export default function SetupStepOne() {
  const router = useRouter();
  const { status, businesses, authedFetch, refreshMe } = useAuth();
  const existing = getOnboardingBusiness(businesses);

  const [draft, setDraft] = useState<BusinessDraft>({
    name: existing?.name ?? '',
    businessType: (existing?.business_type as BusinessDraft['businessType']) ?? '',
    city: existing?.city ?? '',
    tagline: existing?.tagline ?? '',
  });

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
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

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!draft.name.trim()) errors.name = s1.errors.nameRequired;
    if (!draft.businessType) errors.businessType = s1.errors.typeRequired;
    if (!draft.city.trim()) errors.city = s1.errors.cityRequired;
    return errors;
  }

  function mapError(err: unknown) {
    if (err instanceof ApiError && err.code === 'BUSINESS_LIMIT_REACHED') {
      setFormError(s1.errors.businessLimit);
    } else if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
      setFormError(s1.errors.network);
    } else if (err instanceof ApiError) {
      setFormError(err.message || s1.errors.generic);
    } else {
      setFormError(s1.errors.generic);
    }
  }

  async function save(): Promise<Business | null> {
    const errors = validate();
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return null;

    setSubmitting(true);
    try {
      const payload = {
        name: draft.name.trim(),
        business_type: draft.businessType,
        city: draft.city.trim(),
        tagline: draft.tagline.trim(),
      };
      let business: Business;
      if (existing) {
        business = await authedFetch<Business>(`/businesses/${existing.id}/`, {
          method: 'PATCH',
          body: { ...payload, onboarding_step: 2 },
        });
      } else {
        const created = await authedFetch<Business>('/businesses/', {
          method: 'POST',
          body: payload,
        });
        business = await authedFetch<Business>(`/businesses/${created.id}/`, {
          method: 'PATCH',
          body: { onboarding_step: 2 },
        });
      }
      await authedFetch(`/businesses/${business.id}/onboarding/1/`, {
        method: 'PATCH',
        body: { status: 'done' },
      });
      await refreshMe();
      return business;
    } catch (err) {
      mapError(err);
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNext() {
    const business = await save();
    if (business) router.push('/setup/2');
  }

  async function handleSaveForLater() {
    const business = await save();
    if (business) router.replace('/home');
  }

  return (
    <Screen
      maxWidth={WIZARD_CONTENT_WIDTH}
      bottomBar={
        <BottomActionBar
          primaryLabel={s.next}
          onPrimaryPress={handleNext}
          primaryLoading={submitting}
        />
      }
    >
      <StepHeader current={1} total={s.totalSteps} onSaveForLater={handleSaveForLater} />

      <Body style={styles.title}>{s1.title}</Body>

      {formError ? (
        <View style={styles.formError}>
          <Icon name="error" size={type.md} colour={colours.danger} />
          <Body style={styles.formErrorText}>{formError}</Body>
        </View>
      ) : null}

      <BusinessForm
        value={draft}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        errors={fieldErrors}
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
