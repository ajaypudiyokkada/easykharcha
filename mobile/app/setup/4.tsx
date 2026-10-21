import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ApiError, type RowError } from '../../src/api/client';
import type { SellItem, StarterPack } from '../../src/api/stock';
import { useAuth } from '../../src/auth/AuthContext';
import { getOnboardingBusiness } from '../../src/business/routing';
import { groupItems } from '../../src/forms/groupItems';
import { itemDraftStorage } from '../../src/forms/itemDraftStorage';
import {
  EMPTY_SELL_ITEM_DRAFT,
  SellItemForm,
  type SellItemDraft,
} from '../../src/forms/SellItemForm';
import { validateSellItemDraft } from '../../src/forms/validateSellItem';
import { useInstantAdd } from '../../src/hooks/useInstantAdd';
import { sellItemLabel } from '../../src/labels';
import { strings } from '../../src/strings';
import {
  Banner,
  BottomActionBar,
  Body,
  Checkbox,
  GroupedList,
  Icon,
  Screen,
  Small,
  StepHeader,
  TextField,
  Toast,
} from '../../src/ui';
import { useMinWidth } from '../../src/hooks/useMinWidth';
import { BREAKPOINT_DESKTOP, MIN_TOUCH_TARGET, WIZARD_CONTENT_WIDTH } from '../../src/ui/constants';
import { colours, fonts, radii, spacing, type } from '../../src/theme/tokens';

const s = strings.setup;
const s4 = strings.setup.step4;

export default function SetupStepFour() {
  const router = useRouter();
  const { status, businesses, authedFetch, refreshMe } = useAuth();
  const onboardingBusiness = getOnboardingBusiness(businesses);
  const twoColumns = useMinWidth(BREAKPOINT_DESKTOP);

  const [starterPack, setStarterPack] = useState<StarterPack | null>(null);
  const [tickedStarter, setTickedStarter] = useState<Record<string, boolean>>({});
  const [starterPrices, setStarterPrices] = useState<Record<string, string>>({});
  const [starterErrors, setStarterErrors] = useState<Record<string, string>>({});

  const [items, setItems] = useState<SellItem[] | null>(null);
  const [addFieldErrors, setAddFieldErrors] = useState<ReturnType<typeof validateSellItemDraft>>(
    {},
  );
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const draftScope = onboardingBusiness ? `sell.${onboardingBusiness.id}` : null;

  useEffect(() => {
    if (!onboardingBusiness) return;
    authedFetch<StarterPack>(`/starter-packs/${onboardingBusiness.business_type}/`)
      .then(setStarterPack)
      .catch(() => setStarterPack({ stock_items: [], sell_items: [] }));
    authedFetch<SellItem[]>(`/businesses/${onboardingBusiness.id}/sell-items/`)
      .then(setItems)
      .catch(() => setItems([]));
    // Fetches once for the business this screen is onboarding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingBusiness?.id, onboardingBusiness?.business_type]);

  const instant = useInstantAdd<SellItem, SellItemDraft>({
    items: items ?? [],
    setItems: (updater) => setItems((current) => updater(current ?? [])),
    emptyDraft: EMPTY_SELL_ITEM_DRAFT,
    toOptimistic: (draft) => ({
      id: 0,
      name: draft.name.trim(),
      selling_price: draft.sellingPrice.trim(),
      portion_label: draft.portionLabel.trim(),
      recipe_status: 'none',
      ingredients: [],
      group: draft.group.trim(),
      active: true,
      created_at: new Date().toISOString(),
    }),
    save: async (draft) => {
      const results = await authedFetch<SellItem[]>(
        `/businesses/${onboardingBusiness!.id}/sell-items/bulk/`,
        {
          method: 'POST',
          body: {
            items: [
              {
                name: draft.name.trim(),
                selling_price: draft.sellingPrice.trim(),
                portion_label: draft.portionLabel.trim() || undefined,
                group: draft.group.trim() || undefined,
              },
            ],
          },
        },
      );
      return results[0];
    },
  });

  useEffect(() => {
    if (!draftScope) return;
    itemDraftStorage.load<SellItemDraft>(draftScope).then((saved) => {
      if (saved) instant.setDraftState(saved);
    });
    // Only on mount for this business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftScope]);

  useEffect(() => {
    if (!draftScope) return;
    const isEmpty = JSON.stringify(instant.draft) === JSON.stringify(EMPTY_SELL_ITEM_DRAFT);
    if (isEmpty) {
      itemDraftStorage.clear(draftScope);
    } else {
      itemDraftStorage.save(draftScope, instant.draft);
    }
  }, [draftScope, instant.draft]);

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

  const label = sellItemLabel(business.business_type);
  const allItems = items ?? [];
  const existingGroups = [...new Set(allItems.map((item) => item.group).filter(Boolean))];
  const addedGroups = groupItems(allItems);

  async function handleAdd() {
    setAddFormError(null);
    const errors = validateSellItemDraft(instant.draft, allItems);
    setAddFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    try {
      await instant.add();
      setAddFieldErrors({});
      setToast(s4.addedToast);
      if (draftScope) await itemDraftStorage.clear(draftScope);
    } catch (err) {
      if (err instanceof ApiError && err.rowErrors && err.rowErrors[0]) {
        setAddFormError(err.rowErrors[0].message);
      } else if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
        setAddFormError(s4.errors.network);
      } else if (err instanceof ApiError) {
        setAddFormError(err.message || s4.errors.generic);
      } else {
        setAddFormError(s4.errors.generic);
      }
    }
  }

  async function handleRemove(item: SellItem) {
    setItems((current) => (current ?? []).filter((i) => i.id !== item.id));
    try {
      await authedFetch(`/businesses/${business.id}/sell-items/${item.id}/`, {
        method: 'PATCH',
        body: { active: false },
      });
    } catch {
      setItems((current) => [...(current ?? []), item]);
    }
  }

  function validateStarterPrices(): boolean {
    const errors: Record<string, string> = {};
    for (const item of starterPack?.sell_items ?? []) {
      if (tickedStarter[item.name] && !(starterPrices[item.name] ?? '').trim()) {
        errors[item.name] = s4.errors.priceRequired;
      }
    }
    if (Object.keys(errors).length > 0) {
      setStarterErrors((current) => ({ ...current, ...errors }));
      return false;
    }
    return true;
  }

  function buildStarterPayload() {
    const existingNames = new Set(allItems.map((item) => item.name.toLowerCase()));
    return (starterPack?.sell_items ?? [])
      .filter((item) => tickedStarter[item.name] && !existingNames.has(item.name.toLowerCase()))
      .map((item) => ({
        name: item.name,
        selling_price: (starterPrices[item.name] ?? '').trim(),
      }));
  }

  function applyRowErrors(rowErrors: RowError[]) {
    const nextStarterErrors: Record<string, string> = {};
    const tickedNames = buildStarterPayload().map((item) => item.name);
    for (const err of rowErrors) {
      const name = tickedNames[err.row - 1];
      if (name) nextStarterErrors[name] = err.message;
    }
    setStarterErrors(nextStarterErrors);
  }

  function mapSubmitError(err: unknown) {
    if (err instanceof ApiError && err.rowErrors) {
      applyRowErrors(err.rowErrors);
      setSubmitError(s4.errors.generic);
    } else if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
      setSubmitError(s4.errors.network);
    } else if (err instanceof ApiError) {
      setSubmitError(err.message || s4.errors.generic);
    } else {
      setSubmitError(s4.errors.generic);
    }
  }

  async function save(): Promise<boolean> {
    setSubmitError(null);
    setStarterErrors({});
    if (!validateStarterPrices()) return false;
    const starterRows = buildStarterPayload();
    if (starterRows.length === 0 && allItems.length === 0) {
      setSubmitError(s4.errors.minimumOne);
      return false;
    }

    setSubmitting(true);
    try {
      if (starterRows.length > 0) {
        await authedFetch(`/businesses/${business.id}/sell-items/bulk/`, {
          method: 'POST',
          body: { items: starterRows },
        });
      }
      await authedFetch(`/businesses/${business.id}/onboarding/4/`, {
        method: 'PATCH',
        body: { status: 'done' },
      });
      await authedFetch(`/businesses/${business.id}/`, {
        method: 'PATCH',
        body: { onboarding_step: 5 },
      });
      await refreshMe();
      return true;
    } catch (err) {
      mapSubmitError(err);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNext() {
    if (await save()) router.push('/setup/5');
  }

  async function handleSaveForLater() {
    if (await save()) router.replace('/home');
  }

  async function handleSkip() {
    setSubmitError(null);
    setSkipping(true);
    try {
      await authedFetch(`/businesses/${business.id}/onboarding/4/`, {
        method: 'PATCH',
        body: { status: 'skipped' },
      });
      await authedFetch(`/businesses/${business.id}/`, {
        method: 'PATCH',
        body: { onboarding_step: 5 },
      });
      await refreshMe();
      router.push('/setup/5');
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
          primaryDisabled={skipping}
          skipLabel={s.skipForNow}
          onSkipPress={handleSkip}
        />
      }
    >
      <StepHeader
        current={4}
        total={s.totalSteps}
        onBack={() => router.push('/setup/3')}
        onSaveForLater={handleSaveForLater}
      />

      <Body style={styles.title}>{s4.title}</Body>
      <Small style={styles.subtitle}>{s4.stepIntro}</Small>

      {submitError ? (
        <View style={styles.formError}>
          <Icon name="error" size={type.md} colour={colours.danger} />
          <Body style={styles.formErrorText}>{submitError}</Body>
        </View>
      ) : null}

      {starterPack && starterPack.sell_items.length > 0 ? (
        <View style={styles.field}>
          <Body style={styles.sectionLabel}>{s4.pickCommon}</Body>
          {starterPack.sell_items.map((item) => (
            <View key={item.name} style={styles.field}>
              <Checkbox
                checked={Boolean(tickedStarter[item.name])}
                onChange={(checked) =>
                  setTickedStarter((current) => ({ ...current, [item.name]: checked }))
                }
                title={item.name}
              />
              {tickedStarter[item.name] ? (
                <TextField
                  label={s4.priceLabel}
                  value={starterPrices[item.name] ?? ''}
                  onChangeText={(price) =>
                    setStarterPrices((current) => ({ ...current, [item.name]: price }))
                  }
                  placeholder={s4.pricePlaceholder}
                  keyboardType="decimal-pad"
                  error={starterErrors[item.name]}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {addedGroups.length > 0 ? (
        <View style={styles.field}>
          <Body style={styles.sectionLabel}>{s4.addedItems}</Body>
          <GroupedList
            groups={addedGroups}
            getKey={(item) => item.id}
            renderItem={(item) => {
              return (
                <View style={[styles.itemRow, twoColumns ? styles.itemRowHalf : null]}>
                  <View style={styles.itemRowCopy}>
                    <Body style={styles.itemRowName}>{item.name}</Body>
                    <Small style={styles.itemRowMeta}>
                      ₹{item.selling_price}
                      {item.portion_label ? ` · ${item.portion_label}` : ''}
                    </Small>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${s4.remove} ${item.name}`}
                    onPress={() => handleRemove(item)}
                    style={styles.itemAction}
                  >
                    <Icon name="delete" size={18} colour={colours.danger} />
                  </Pressable>
                </View>
              );
            }}
          />
        </View>
      ) : null}

      <View style={styles.field}>
        <Body style={styles.sectionLabel}>{s4.addOwn(label)}</Body>

        {addFormError ? <Banner kind="error">{addFormError}</Banner> : null}
        <SellItemForm
          value={instant.draft}
          onChange={instant.setDraft}
          errors={addFieldErrors}
          businessType={business.business_type}
          existingGroups={existingGroups}
          nameFieldRef={instant.nameFieldRef}
        />

        <Pressable
          accessibilityRole="button"
          onPress={handleAdd}
          style={[styles.addButton, instant.saving ? styles.addButtonDisabled : null]}
          disabled={instant.saving}
        >
          <Body style={styles.addButtonText}>{s4.addItem}</Body>
        </Pressable>
      </View>

      <Toast message={toast} onHide={() => setToast(null)} />
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
  addButton: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.primary,
    borderRadius: radii.pill,
  },
  addButtonDisabled: {
    opacity: 0.6,
  },
  addButtonText: {
    color: colours.primary,
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
