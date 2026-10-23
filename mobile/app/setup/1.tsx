import { Redirect, useRouter } from 'expo-router';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { Business } from '../../src/api/business';
import { ApiError, type ItemsSummary } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { getOnboardingBusiness } from '../../src/business/routing';
import { BUSINESS_TYPES } from '../../src/constants/businessTypes';
import {
  BusinessForm,
  EMPTY_BUSINESS_DRAFT,
  type BusinessDraft,
} from '../../src/forms/BusinessForm';
import {
  ChangeBusinessTypeSheet,
  type ItemsAction,
} from '../../src/screens/ChangeBusinessTypeSheet';
import { strings } from '../../src/strings';
import { BottomActionBar, Body, Icon, Screen, Small, StepHeader } from '../../src/ui';
import { MIN_TOUCH_TARGET, WIZARD_CONTENT_WIDTH } from '../../src/ui/constants';
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
  // Step F2: sign-up already asks for the business name, so a business created there always has
  // one — this step only re-asks it for the fallback case (an older account, invite, or a business
  // that somehow has no name yet).
  const hasName = Boolean(existing?.name?.trim());
  const [editingName, setEditingName] = useState(false);

  const [draft, setDraft] = useState<BusinessDraft>({
    ...EMPTY_BUSINESS_DRAFT,
    name: existing?.name ?? '',
    businessType: (existing?.business_type as BusinessDraft['businessType']) ?? '',
    city: existing?.city ?? '',
    pincode: existing?.pincode ?? '',
    state: existing?.state ?? '',
    tagline: existing?.tagline ?? '',
  });

  // `existing` can arrive a render after mount — right after sign-up, this screen is reached by a
  // client-side redirect that can land before AuthContext's post-login businesses fetch has
  // committed, so the useState initializer above sometimes captures nothing. Re-hydrate once the
  // real business shows up, rather than leaving the draft stuck on whatever was there at mount.
  const hydratedBusinessId = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!existing || hydratedBusinessId.current === existing.id) return;
    hydratedBusinessId.current = existing.id;
    setDraft((current) => ({
      ...current,
      name: existing.name,
      businessType:
        (existing.business_type as BusinessDraft['businessType']) || current.businessType,
      city: existing.city || current.city,
      pincode: existing.pincode || current.pincode,
      state: existing.state || current.state,
      tagline: existing.tagline || current.tagline,
    }));
  }, [existing]);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [itemsSummary, setItemsSummary] = useState<ItemsSummary | null>(null);
  const [itemsSheetSaving, setItemsSheetSaving] = useState(false);
  // Which button started the save that's now waiting on the items-decision sheet, so the sheet's
  // own Continue can send the user on to the same place "Next" or "Save for later" would have.
  const pendingAfterRef = useRef<'next' | 'later'>('next');

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

  async function save(itemsAction?: ItemsAction): Promise<Business | null> {
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
        pincode: draft.pincode,
        state: draft.state,
        manual_location: draft.manualLocation,
        tagline: draft.tagline.trim(),
      };
      let business: Business;
      if (existing) {
        business = await authedFetch<Business>(`/businesses/${existing.id}/`, {
          method: 'PATCH',
          body: {
            ...payload,
            onboarding_step: 2,
            ...(itemsAction ? { items_action: itemsAction } : null),
          },
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
      setItemsSummary(null);
      return business;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'items_decision_needed' && err.itemsSummary) {
        setItemsSummary(err.itemsSummary);
      } else {
        mapError(err);
      }
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNext() {
    pendingAfterRef.current = 'next';
    const business = await save();
    if (business) router.push('/setup/2');
  }

  async function handleSaveForLater() {
    pendingAfterRef.current = 'later';
    const business = await save();
    if (business) router.replace('/home');
  }

  function handleCancelItemsDecision() {
    setItemsSummary(null);
    // The sector change itself never saved — put the picker back where the business actually is.
    setDraft((current) => ({
      ...current,
      businessType: (existing?.business_type as BusinessDraft['businessType']) ?? '',
    }));
  }

  async function handleItemsDecision(action: ItemsAction) {
    setItemsSheetSaving(true);
    try {
      const business = await save(action);
      if (!business) return;
      if (action === 'remove') {
        router.push('/setup/3');
      } else if (pendingAfterRef.current === 'later') {
        router.replace('/home');
      } else {
        router.push('/setup/2');
      }
    } finally {
      setItemsSheetSaving(false);
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
        />
      }
    >
      <StepHeader current={1} total={s.totalSteps} onSaveForLater={handleSaveForLater} />

      <Body style={styles.title}>{s1.title}</Body>

      {hasName && !editingName ? (
        <View style={styles.nameRow}>
          <Body style={styles.nameRowText}>{draft.name}</Body>
          <Pressable
            accessibilityRole="button"
            style={styles.changeTap}
            onPress={() => setEditingName(true)}
          >
            <Small style={styles.changeLink}>{s1.changeName}</Small>
          </Pressable>
        </View>
      ) : null}

      {formError ? (
        <View style={styles.formError}>
          <Icon name="error" size={type.md} colour={colours.danger} />
          <Body style={styles.formErrorText}>{formError}</Body>
        </View>
      ) : null}

      <BusinessForm
        value={draft}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        authedFetch={authedFetch}
        errors={fieldErrors}
        showName={!hasName || editingName}
      />

      {itemsSummary ? (
        <ChangeBusinessTypeSheet
          visible
          itemsSummary={itemsSummary}
          newTypeLabel={
            BUSINESS_TYPES.find((t) => t.value === draft.businessType)?.label ?? draft.businessType
          }
          onCancel={handleCancelItemsDecision}
          onContinue={handleItemsDecision}
          continueLoading={itemsSheetSaving}
        />
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  nameRowText: {
    fontFamily: fonts.bodyExtraBold,
    flexShrink: 1,
  },
  changeTap: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  changeLink: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
    textDecorationLine: 'underline',
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
