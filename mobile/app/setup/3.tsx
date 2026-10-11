import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ApiError, type RowError } from '../../src/api/client';
import type { StarterPack } from '../../src/api/stock';
import { useAuth } from '../../src/auth/AuthContext';
import { getOnboardingBusiness } from '../../src/business/routing';
import { UNITS, type UnitValue } from '../../src/constants/units';
import { strings } from '../../src/strings';
import {
  BottomActionBar,
  Body,
  Checkbox,
  Icon,
  Screen,
  Small,
  StepHeader,
  TextField,
  Toggle,
} from '../../src/ui';
import { colours, fonts, radii, spacing, type } from '../../src/theme/tokens';

const s = strings.setup;
const s3 = strings.setup.step3;

type OwnStockDraft = {
  name: string;
  unit: UnitValue | '';
  usualPrice: string;
  supplier: string;
  shared: boolean;
  goesOff: boolean;
  shelfLifeDays: string;
};

const EMPTY_DRAFT: OwnStockDraft = {
  name: '',
  unit: '',
  usualPrice: '',
  supplier: '',
  shared: false,
  goesOff: false,
  shelfLifeDays: '',
};

export default function SetupStepThree() {
  const router = useRouter();
  const { status, businesses, authedFetch, refreshMe } = useAuth();
  const onboardingBusiness = getOnboardingBusiness(businesses);

  const [starterPack, setStarterPack] = useState<StarterPack | null>(null);
  const [tickedStarter, setTickedStarter] = useState<Record<string, boolean>>({});
  const [starterErrors, setStarterErrors] = useState<Record<string, string>>({});

  const [ownItems, setOwnItems] = useState<OwnStockDraft[]>([]);
  const [ownItemErrors, setOwnItemErrors] = useState<Record<number, string>>({});
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<OwnStockDraft>(EMPTY_DRAFT);
  const [draftErrors, setDraftErrors] = useState<{ name?: string; unit?: string }>({});

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    if (!onboardingBusiness) return;
    authedFetch<StarterPack>(`/starter-packs/${onboardingBusiness.business_type}/`)
      .then(setStarterPack)
      .catch(() => setStarterPack({ stock_items: [], sell_items: [] }));
    // Fetches once for the business this screen is onboarding — business_type doesn't change here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingBusiness?.business_type]);

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

  function resetDraft() {
    setDraft(EMPTY_DRAFT);
    setDraftErrors({});
    setEditingIndex(null);
  }

  function handleAddOrUpdateItem() {
    const errors: { name?: string; unit?: string } = {};
    if (!draft.name.trim()) errors.name = s3.errors.nameRequired;
    if (!draft.unit) errors.unit = s3.errors.unitRequired;
    setDraftErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const item: OwnStockDraft = { ...draft, name: draft.name.trim() };
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

  function buildPayload() {
    const starterRows = (starterPack?.stock_items ?? [])
      .filter((item) => tickedStarter[item.name])
      .map((item) => ({ name: item.name, unit: item.unit }));
    const ownRows = ownItems.map((item) => ({
      name: item.name,
      unit: item.unit,
      usual_price: item.usualPrice.trim() || undefined,
      supplier: item.supplier.trim() || undefined,
      shared: item.shared,
      goes_off: item.goesOff,
      shelf_life_days:
        item.goesOff && item.shelfLifeDays.trim() ? Number(item.shelfLifeDays) : undefined,
    }));
    return { starterRows, ownRows, items: [...starterRows, ...ownRows] };
  }

  function applyRowErrors(rowErrors: RowError[], starterCount: number) {
    const nextStarterErrors: Record<string, string> = {};
    const nextOwnErrors: Record<number, string> = {};
    const tickedNames = (starterPack?.stock_items ?? [])
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
      setSubmitError(s3.errors.generic);
    } else if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
      setSubmitError(s3.errors.network);
    } else if (err instanceof ApiError) {
      setSubmitError(err.message || s3.errors.generic);
    } else {
      setSubmitError(s3.errors.generic);
    }
  }

  async function save(): Promise<boolean> {
    setSubmitError(null);
    setStarterErrors({});
    setOwnItemErrors({});
    const { starterRows, items } = buildPayload();
    if (items.length === 0) {
      setSubmitError(s3.errors.minimumOne);
      return false;
    }

    setSubmitting(true);
    try {
      await authedFetch(`/businesses/${business.id}/stock-items/bulk/`, {
        method: 'POST',
        body: { items },
      });
      await authedFetch(`/businesses/${business.id}/onboarding/3/`, {
        method: 'PATCH',
        body: { status: 'done' },
      });
      await authedFetch(`/businesses/${business.id}/`, {
        method: 'PATCH',
        body: { onboarding_step: 4 },
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
        current={3}
        total={s.totalSteps}
        onBack={() => router.push('/setup/2')}
        onSaveForLater={handleSaveForLater}
      />

      <Body style={styles.title}>{s3.title}</Body>

      {submitError ? (
        <View style={styles.formError}>
          <Icon name="error" size={type.md} colour={colours.danger} />
          <Body style={styles.formErrorText}>{submitError}</Body>
        </View>
      ) : null}

      {starterPack && starterPack.stock_items.length > 0 ? (
        <View style={styles.field}>
          <Body style={styles.sectionLabel}>{s3.pickCommon}</Body>
          {starterPack.stock_items.map((item) => (
            <View key={item.name} style={styles.field}>
              <Checkbox
                checked={Boolean(tickedStarter[item.name])}
                onChange={(checked) =>
                  setTickedStarter((current) => ({ ...current, [item.name]: checked }))
                }
                title={item.name}
                helpText={item.unit}
              />
              {starterErrors[item.name] ? (
                <View style={styles.formError}>
                  <Icon name="error" size={type.sm} colour={colours.danger} />
                  <Small style={styles.formErrorText}>{starterErrors[item.name]}</Small>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.field}>
        <Body style={styles.sectionLabel}>{s3.addOwn}</Body>

        <TextField
          label={s3.nameLabel}
          value={draft.name}
          onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
          placeholder={s3.namePlaceholder}
          error={draftErrors.name}
        />

        <View style={styles.field}>
          <Small style={styles.unitLabel}>{s3.unitLabel}</Small>
          <View style={styles.unitRow}>
            {UNITS.map((unit) => {
              const selected = draft.unit === unit.value;
              return (
                <Pressable
                  key={unit.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => setDraft((current) => ({ ...current, unit: unit.value }))}
                  style={[styles.unitChip, selected ? styles.unitChipSelected : null]}
                >
                  <Small style={selected ? styles.unitChipTextSelected : styles.unitChipText}>
                    {unit.label}
                  </Small>
                </Pressable>
              );
            })}
          </View>
          {draftErrors.unit ? (
            <View style={styles.formError}>
              <Icon name="error" size={type.sm} colour={colours.danger} />
              <Small style={styles.formErrorText}>{draftErrors.unit}</Small>
            </View>
          ) : null}
        </View>

        <TextField
          label={s3.priceLabel}
          value={draft.usualPrice}
          onChangeText={(usualPrice) => setDraft((current) => ({ ...current, usualPrice }))}
          placeholder={s3.pricePlaceholder}
          keyboardType="decimal-pad"
        />

        <TextField
          label={s3.supplierLabel}
          value={draft.supplier}
          onChangeText={(supplier) => setDraft((current) => ({ ...current, supplier }))}
          placeholder={s3.supplierPlaceholder}
        />

        <Toggle
          title={s3.sharedToggle}
          value={draft.shared}
          onChange={(shared) => setDraft((current) => ({ ...current, shared }))}
        />

        <Toggle
          title={s3.goesOffToggle}
          value={draft.goesOff}
          onChange={(goesOff) => setDraft((current) => ({ ...current, goesOff }))}
        />

        {draft.goesOff ? (
          <TextField
            label={s3.shelfLifeLabel}
            value={draft.shelfLifeDays}
            onChangeText={(shelfLifeDays) => setDraft((current) => ({ ...current, shelfLifeDays }))}
            placeholder={s3.shelfLifePlaceholder}
            keyboardType="number-pad"
          />
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={handleAddOrUpdateItem}
          style={styles.addButton}
        >
          <Body style={styles.addButtonText}>
            {editingIndex !== null ? s3.updateItem : s3.addItem}
          </Body>
        </Pressable>
      </View>

      {ownItems.length > 0 ? (
        <View style={styles.field}>
          <Body style={styles.sectionLabel}>{s3.addedItems}</Body>
          {ownItems.map((item, index) => (
            <View key={`${item.name}-${index}`} style={styles.itemRow}>
              <View style={styles.itemRowCopy}>
                <Body style={styles.itemRowName}>{item.name}</Body>
                <Small style={styles.itemRowMeta}>
                  {item.unit}
                  {item.shared ? ' · shared' : ''}
                  {item.goesOff ? ' · goes off' : ''}
                </Small>
                {ownItemErrors[index] ? (
                  <Small style={styles.formErrorText}>{ownItemErrors[index]}</Small>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${s3.edit} ${item.name}`}
                onPress={() => handleEditItem(index)}
                style={styles.itemAction}
              >
                <Icon name="edit" size={18} colour={colours.primary} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${s3.remove} ${item.name}`}
                onPress={() => handleRemoveItem(index)}
                style={styles.itemAction}
              >
                <Icon name="delete" size={18} colour={colours.danger} />
              </Pressable>
            </View>
          ))}
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
