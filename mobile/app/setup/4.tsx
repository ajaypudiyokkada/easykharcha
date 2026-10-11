import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ApiError, type RowError } from '../../src/api/client';
import type { StarterPack, StockItem } from '../../src/api/stock';
import { useAuth } from '../../src/auth/AuthContext';
import { getOnboardingBusiness } from '../../src/business/routing';
import { sellItemLabel } from '../../src/labels';
import { strings } from '../../src/strings';
import {
  BottomActionBar,
  Body,
  Checkbox,
  Icon,
  Muted,
  Screen,
  Small,
  StepHeader,
  TextField,
} from '../../src/ui';
import { colours, fonts, radii, spacing, type } from '../../src/theme/tokens';

const s = strings.setup;
const s4 = strings.setup.step4;

type OwnSellDraft = {
  name: string;
  sellingPrice: string;
  mainStockItemId: number | null;
};

const EMPTY_DRAFT: OwnSellDraft = { name: '', sellingPrice: '', mainStockItemId: null };

export default function SetupStepFour() {
  const router = useRouter();
  const { status, businesses, authedFetch, refreshMe } = useAuth();
  const onboardingBusiness = getOnboardingBusiness(businesses);

  const [starterPack, setStarterPack] = useState<StarterPack | null>(null);
  const [tickedStarter, setTickedStarter] = useState<Record<string, boolean>>({});
  const [starterPrices, setStarterPrices] = useState<Record<string, string>>({});
  const [starterErrors, setStarterErrors] = useState<Record<string, string>>({});

  const [stockItems, setStockItems] = useState<StockItem[] | null>(null);

  const [ownItems, setOwnItems] = useState<OwnSellDraft[]>([]);
  const [ownItemErrors, setOwnItemErrors] = useState<Record<number, string>>({});
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<OwnSellDraft>(EMPTY_DRAFT);
  const [draftErrors, setDraftErrors] = useState<{ name?: string; price?: string }>({});

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    if (!onboardingBusiness) return;
    authedFetch<StarterPack>(`/starter-packs/${onboardingBusiness.business_type}/`)
      .then(setStarterPack)
      .catch(() => setStarterPack({ stock_items: [], sell_items: [] }));
    authedFetch<StockItem[]>(`/businesses/${onboardingBusiness.id}/stock-items/`)
      .then(setStockItems)
      .catch(() => setStockItems([]));
    // Fetches once for the business this screen is onboarding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingBusiness?.id, onboardingBusiness?.business_type]);

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
  const linkableStockItems = (stockItems ?? []).filter((item) => !item.shared);

  function resetDraft() {
    setDraft(EMPTY_DRAFT);
    setDraftErrors({});
    setEditingIndex(null);
  }

  function handleAddOrUpdateItem() {
    const errors: { name?: string; price?: string } = {};
    if (!draft.name.trim()) errors.name = s4.errors.nameRequired;
    if (!draft.sellingPrice.trim()) errors.price = s4.errors.priceRequired;
    setDraftErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const item: OwnSellDraft = { ...draft, name: draft.name.trim() };
    setOwnItems((current) => {
      if (editingIndex !== null) {
        const next = [...current];
        next[editingIndex] = item;
        return next;
      }
      return [...current, item];
    });
    resetDraft();
  }

  function handleEditItem(index: number) {
    setDraft(ownItems[index]);
    setEditingIndex(index);
    setDraftErrors({});
  }

  function handleRemoveItem(index: number) {
    setOwnItems((current) => current.filter((_, i) => i !== index));
    setOwnItemErrors({});
    if (editingIndex === index) resetDraft();
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

  function buildPayload() {
    const starterRows = (starterPack?.sell_items ?? [])
      .filter((item) => tickedStarter[item.name])
      .map((item) => ({
        name: item.name,
        selling_price: (starterPrices[item.name] ?? '').trim(),
      }));
    const ownRows = ownItems.map((item) => ({
      name: item.name,
      selling_price: item.sellingPrice.trim(),
      main_stock_item: item.mainStockItemId ?? undefined,
    }));
    return { starterRows, ownRows, items: [...starterRows, ...ownRows] };
  }

  function applyRowErrors(rowErrors: RowError[], starterCount: number) {
    const nextStarterErrors: Record<string, string> = {};
    const nextOwnErrors: Record<number, string> = {};
    const tickedNames = (starterPack?.sell_items ?? [])
      .filter((item) => tickedStarter[item.name])
      .map((item) => item.name);
    for (const err of rowErrors) {
      const index = err.row - 1;
      if (index < starterCount) {
        nextStarterErrors[tickedNames[index]] = err.message;
      } else {
        nextOwnErrors[index - starterCount] = err.message;
      }
    }
    setStarterErrors(nextStarterErrors);
    setOwnItemErrors(nextOwnErrors);
  }

  function mapSubmitError(err: unknown, starterCount: number) {
    if (err instanceof ApiError && err.rowErrors) {
      applyRowErrors(err.rowErrors, starterCount);
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
    setOwnItemErrors({});
    if (!validateStarterPrices()) return false;
    const { starterRows, items } = buildPayload();
    if (items.length === 0) {
      setSubmitError(s4.errors.minimumOne);
      return false;
    }

    setSubmitting(true);
    try {
      await authedFetch(`/businesses/${business.id}/sell-items/bulk/`, {
        method: 'POST',
        body: { items },
      });
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
      mapSubmitError(err, starterRows.length);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNext() {
    if (await save()) router.push('/setup/saved');
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
      router.push('/setup/saved');
    } catch (err) {
      mapSubmitError(err, 0);
    } finally {
      setSkipping(false);
    }
  }

  return (
    <Screen
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

      <View style={styles.field}>
        <Body style={styles.sectionLabel}>{s4.addOwn(label)}</Body>

        <TextField
          label={s4.nameLabel}
          value={draft.name}
          onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
          placeholder={s4.namePlaceholder}
          error={draftErrors.name}
        />

        <TextField
          label={s4.priceLabel}
          value={draft.sellingPrice}
          onChangeText={(sellingPrice) => setDraft((current) => ({ ...current, sellingPrice }))}
          placeholder={s4.pricePlaceholder}
          keyboardType="decimal-pad"
          error={draftErrors.price}
        />

        <View style={styles.field}>
          <Small style={styles.unitLabel}>{s4.mainStockItemLabel}</Small>
          {stockItems === null ? (
            <ActivityIndicator color={colours.primary} />
          ) : linkableStockItems.length === 0 ? (
            <Muted size="sm">{s4.noStockItemsYet}</Muted>
          ) : (
            <View style={styles.unitRow}>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: draft.mainStockItemId === null }}
                onPress={() => setDraft((current) => ({ ...current, mainStockItemId: null }))}
                style={[
                  styles.unitChip,
                  draft.mainStockItemId === null ? styles.unitChipSelected : null,
                ]}
              >
                <Small
                  style={
                    draft.mainStockItemId === null
                      ? styles.unitChipTextSelected
                      : styles.unitChipText
                  }
                >
                  {s4.noMainStockItem}
                </Small>
              </Pressable>
              {linkableStockItems.map((item) => {
                const selected = draft.mainStockItemId === item.id;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() =>
                      setDraft((current) => ({ ...current, mainStockItemId: item.id }))
                    }
                    style={[styles.unitChip, selected ? styles.unitChipSelected : null]}
                  >
                    <Small style={selected ? styles.unitChipTextSelected : styles.unitChipText}>
                      {item.name}
                    </Small>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={handleAddOrUpdateItem}
          style={styles.addButton}
        >
          <Body style={styles.addButtonText}>
            {editingIndex !== null ? s4.updateItem : s4.addItem}
          </Body>
        </Pressable>
      </View>

      {ownItems.length > 0 ? (
        <View style={styles.field}>
          <Body style={styles.sectionLabel}>{s4.addedItems}</Body>
          {ownItems.map((item, index) => {
            const linked = linkableStockItems.find((s) => s.id === item.mainStockItemId);
            return (
              <View key={`${item.name}-${index}`} style={styles.itemRow}>
                <View style={styles.itemRowCopy}>
                  <Body style={styles.itemRowName}>{item.name}</Body>
                  <Small style={styles.itemRowMeta}>
                    ₹{item.sellingPrice}
                    {linked ? ` · ${linked.name}` : ''}
                  </Small>
                  {ownItemErrors[index] ? (
                    <Small style={styles.formErrorText}>{ownItemErrors[index]}</Small>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${s4.edit} ${item.name}`}
                  onPress={() => handleEditItem(index)}
                  style={styles.itemAction}
                >
                  <Icon name="edit" size={18} colour={colours.primary} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${s4.remove} ${item.name}`}
                  onPress={() => handleRemoveItem(index)}
                  style={styles.itemAction}
                >
                  <Icon name="delete" size={18} colour={colours.danger} />
                </Pressable>
              </View>
            );
          })}
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
  unitLabel: {
    fontFamily: fonts.bodyExtraBold,
  },
  unitRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  unitChip: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.pill,
    backgroundColor: colours.card,
  },
  unitChipSelected: {
    borderColor: colours.primary,
    backgroundColor: colours.mint,
  },
  unitChipText: {
    color: colours.text,
  },
  unitChipTextSelected: {
    color: colours.text,
    fontFamily: fonts.bodyExtraBold,
  },
  addButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.primary,
    borderRadius: radii.pill,
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
  itemRowCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  itemRowName: {
    fontFamily: fonts.bodyExtraBold,
  },
  itemRowMeta: {
    color: colours.muted,
  },
  itemAction: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
