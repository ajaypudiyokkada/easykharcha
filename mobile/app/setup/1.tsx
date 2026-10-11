import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { Business } from '../../src/api/business';
import { ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { getOnboardingBusiness } from '../../src/business/routing';
import { BUSINESS_TYPES, type BusinessTypeValue } from '../../src/constants/businessTypes';
import { strings } from '../../src/strings';
import { BottomActionBar, Body, Icon, Screen, StepHeader, TextField } from '../../src/ui';
import { colours, fonts, radii, spacing, type } from '../../src/theme/tokens';

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

  const [name, setName] = useState(existing?.name ?? '');
  const [businessType, setBusinessType] = useState<BusinessTypeValue | ''>(
    (existing?.business_type as BusinessTypeValue) ?? '',
  );
  const [city, setCity] = useState(existing?.city ?? '');
  const [tagline, setTagline] = useState(existing?.tagline ?? '');

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
    if (!name.trim()) errors.name = s1.errors.nameRequired;
    if (!businessType) errors.businessType = s1.errors.typeRequired;
    if (!city.trim()) errors.city = s1.errors.cityRequired;
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
        name: name.trim(),
        business_type: businessType,
        city: city.trim(),
        tagline: tagline.trim(),
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

      <TextField
        label={s1.nameLabel}
        value={name}
        onChangeText={setName}
        placeholder={s1.namePlaceholder}
        autoComplete="organization"
        error={fieldErrors.name}
      />

      <View style={styles.field}>
        <Body style={styles.label}>{s1.typeLabel}</Body>
        <View style={styles.typeGrid}>
          {BUSINESS_TYPES.map((option) => {
            const selected = businessType === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => setBusinessType(option.value)}
                style={[styles.typeCard, selected ? styles.typeCardSelected : null]}
              >
                <Body style={[styles.typeCardText, selected ? styles.typeCardTextSelected : null]}>
                  {option.label}
                </Body>
                {selected ? <Icon name="success" size={18} colour={colours.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
        {fieldErrors.businessType ? (
          <View style={styles.formError}>
            <Icon name="error" size={type.md} colour={colours.danger} />
            <Body style={styles.formErrorText}>{fieldErrors.businessType}</Body>
          </View>
        ) : null}
      </View>

      <TextField
        label={s1.cityLabel}
        value={city}
        onChangeText={setCity}
        placeholder={s1.cityPlaceholder}
        error={fieldErrors.city}
      />

      <TextField
        label={s1.taglineLabel}
        value={tagline}
        onChangeText={setTagline}
        placeholder={s1.taglinePlaceholder}
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
  typeGrid: {
    gap: spacing.sm,
  },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colours.card,
  },
  typeCardSelected: {
    borderColor: colours.primary,
    backgroundColor: colours.mint,
  },
  typeCardText: {
    color: colours.text,
  },
  typeCardTextSelected: {
    fontFamily: fonts.bodyExtraBold,
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
