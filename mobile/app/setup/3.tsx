import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ApiError } from '../../src/api/client';
import type { StarterPack, StockItem } from '../../src/api/stock';
import { useAuth } from '../../src/auth/AuthContext';
import { getOnboardingBusiness } from '../../src/business/routing';
import { groupItems } from '../../src/forms/groupItems';
import { itemDraftStorage } from '../../src/forms/itemDraftStorage';
import {
  buildStarterBulkPayload,
  EMPTY_STARTER_PICKER_VALUE,
  fromStarterPickerDraft,
  starterPickerCount,
  StarterStockPicker,
  toStarterPickerDraft,
  type StarterPickerDraft,
  type StarterPickerValue,
} from '../../src/screens/StarterStockPicker';
import { strings } from '../../src/strings';
import { BottomActionBar, Body, GroupedList, Icon, Screen, Small, StepHeader } from '../../src/ui';
import { useMinWidth } from '../../src/hooks/useMinWidth';
import { BREAKPOINT_DESKTOP, MIN_TOUCH_TARGET, WIZARD_CONTENT_WIDTH } from '../../src/ui/constants';
import { colours, fonts, radii, spacing, type } from '../../src/theme/tokens';

const s = strings.setup;
const s3 = strings.setup.step3;

export default function SetupStepThree() {
  const router = useRouter();
  const { status, businesses, authedFetch, refreshMe } = useAuth();
  const onboardingBusiness = getOnboardingBusiness(businesses);
  const twoColumns = useMinWidth(BREAKPOINT_DESKTOP);

  const [starterPack, setStarterPack] = useState<StarterPack | null>(null);
  const [pickerValue, setPickerValue] = useState<StarterPickerValue>(EMPTY_STARTER_PICKER_VALUE);

  const [items, setItems] = useState<StockItem[] | null>(null);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const draftScope = onboardingBusiness ? `stock-picker.${onboardingBusiness.id}` : null;

  useEffect(() => {
    if (!onboardingBusiness) return;
    authedFetch<StarterPack>(`/starter-packs/${onboardingBusiness.business_type}/`)
      .then(setStarterPack)
      .catch(() => setStarterPack({ stock_items: [], sell_items: [] }));
    authedFetch<StockItem[]>(`/businesses/${onboardingBusiness.id}/stock-items/`)
      .then(setItems)
      .catch(() => setItems([]));
    // Fetches once for the business this screen is onboarding — business_type doesn't change here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingBusiness?.business_type]);

  // Restores an in-progress picker selection after a refresh or back/forward — nothing is saved
  // until Continue/Next, so this is the only copy of it until then.
  useEffect(() => {
    if (!draftScope) return;
    itemDraftStorage.load<StarterPickerDraft>(draftScope).then((saved) => {
      if (saved) setPickerValue(fromStarterPickerDraft(saved));
    });
    // Only on mount for this business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftScope]);

  useEffect(() => {
    if (!draftScope) return;
    const isEmpty = pickerValue.ticked.size === 0 && pickerValue.custom.length === 0;
    if (isEmpty) {
      itemDraftStorage.clear(draftScope);
    } else {
      itemDraftStorage.save(draftScope, toStarterPickerDraft(pickerValue));
    }
  }, [draftScope, pickerValue]);

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
  // A plain `const` so the functions below (called later, asynchronously) keep TypeScript's
  // non-null narrowing — the state variable above loses it once captured in a closure.
  const business = onboardingBusiness;
  const allItems = items ?? [];
  const addedGroups = groupItems(allItems);
  const selectedCount = starterPickerCount(pickerValue);

  async function handleRemove(item: StockItem) {
    setItems((current) => (current ?? []).filter((i) => i.id !== item.id));
    try {
      await authedFetch(`/businesses/${business.id}/stock-items/${item.id}/`, {
        method: 'PATCH',
        body: { active: false },
      });
    } catch {
      setItems((current) => [...(current ?? []), item]);
    }
  }

  function mapSubmitError(err: unknown) {
    if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
      setSubmitError(s3.errors.network);
    } else if (err instanceof ApiError) {
      setSubmitError(err.message || s3.errors.generic);
    } else {
      setSubmitError(s3.errors.generic);
    }
  }

  async function save(): Promise<boolean> {
    setSubmitError(null);
    const payload = buildStarterBulkPayload(starterPack?.stock_items ?? [], pickerValue);
    if (payload.items.length === 0 && allItems.length === 0) {
      setSubmitError(s3.errors.minimumOne);
      return false;
    }

    setSubmitting(true);
    try {
      if (payload.items.length > 0) {
        await authedFetch(`/businesses/${business.id}/stock-items/bulk/`, {
          method: 'POST',
          body: payload,
        });
      }
      await authedFetch(`/businesses/${business.id}/onboarding/3/`, {
        method: 'PATCH',
        body: { status: 'done' },
      });
      await authedFetch(`/businesses/${business.id}/`, {
        method: 'PATCH',
        body: { onboarding_step: 4 },
      });
      await refreshMe();
      if (draftScope) await itemDraftStorage.clear(draftScope);
      setPickerValue(EMPTY_STARTER_PICKER_VALUE);
      return true;
    } catch (err) {
      mapSubmitError(err);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNext() {
    if (await save()) router.push('/setup/4');
  }

  async function handleSaveForLater() {
    if (await save()) router.replace('/home');
  }

  async function handleSkip() {
    setSubmitError(null);
    setSkipping(true);
    try {
      await authedFetch(`/businesses/${business.id}/onboarding/3/`, {
        method: 'PATCH',
        body: { status: 'skipped' },
      });
      await authedFetch(`/businesses/${business.id}/`, {
        method: 'PATCH',
        body: { onboarding_step: 4 },
      });
      await refreshMe();
      router.push('/setup/4');
    } catch (err) {
      mapSubmitError(err);
    } finally {
      setSkipping(false);
    }
  }

  const nothingToSave = selectedCount === 0 && allItems.length === 0;

  return (
    <Screen
      maxWidth={WIZARD_CONTENT_WIDTH}
      bottomBar={
        <BottomActionBar
          primaryLabel={s3.continueLabel(selectedCount)}
          onPrimaryPress={handleNext}
          primaryLoading={submitting}
          primaryDisabled={skipping || nothingToSave}
          skipLabel={s.skipForNow}
          onSkipPress={handleSkip}
        />
      }
    >
      <StepHeader
        current={3}
        total={s.totalSteps}
        onBack={() => router.push('/setup/2')}
        onSaveForLater={handleSaveForLater}
      />

      <Body style={styles.title}>{s3.title}</Body>
      <Small style={styles.subtitle}>{s3.stepIntro}</Small>

      {submitError ? (
        <View style={styles.formError}>
          <Icon name="error" size={type.md} colour={colours.danger} />
          <Body style={styles.formErrorText}>{submitError}</Body>
        </View>
      ) : null}

      <View style={styles.field}>
        <Body style={styles.sectionLabel}>{s3.pickCommon}</Body>
        <StarterStockPicker
          catalogue={starterPack?.stock_items ?? []}
          existingItems={allItems}
          value={pickerValue}
          onChange={setPickerValue}
        />
      </View>

      {addedGroups.length > 0 ? (
        <View style={styles.field}>
          <Body style={styles.sectionLabel}>{s3.addedItems}</Body>
          <GroupedList
            groups={addedGroups}
            getKey={(item) => item.id}
            renderItem={(item) => (
              <View style={[styles.itemRow, twoColumns ? styles.itemRowHalf : null]}>
                <View style={styles.itemRowCopy}>
                  <Body style={styles.itemRowName}>{item.name}</Body>
                  <Small style={styles.itemRowMeta}>
                    {item.unit}
                    {item.shared ? ' · shared' : ''}
                    {item.goes_off ? ' · perishable' : ''}
                  </Small>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${s3.remove} ${item.name}`}
                  onPress={() => handleRemove(item)}
                  style={styles.itemAction}
                >
                  <Icon name="delete" size={18} colour={colours.danger} />
                </Pressable>
              </View>
            )}
          />
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
  subtitle: {
    color: colours.muted,
  },
  sectionLabel: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: type.md,
  },
  field: {
    gap: spacing.sm,
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
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  // Two per row at 900px+ — a percentage width, not a fixed pixel one, so it still shrinks cleanly
  // with the wrapping gap rather than overflowing it.
  itemRowHalf: {
    flexBasis: '48%',
    minWidth: 0,
  },
  itemRowCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  itemRowName: {
    fontFamily: fonts.bodyExtraBold,
  },
  itemRowMeta: {
    color: colours.muted,
  },
  itemAction: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
