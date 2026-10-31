import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ApiError } from '../../src/api/client';
import type { EkSetupRun } from '../../src/api/ekSetup';
import type { SellItem } from '../../src/api/stock';
import { useAuth } from '../../src/auth/AuthContext';
import { QuantityInput } from '../../src/forms/QuantityInput';
import {
  addBaseLine,
  addBestSeller,
  addCustomBase,
  addUsedInDish,
  draftFromResult,
  ekSetupDraftStorage,
  removeBaseLine,
  removeUsedInDish,
  setStep,
  toggleBaseKeep,
  toggleBestSeller,
  unitStockItemFor,
  updateBaseLine,
  updateUsedInPortion,
  type EkBaseDraft,
  type EkSetupDraft,
} from '../../src/screens/ekSetupStore';
import { sectorCopyFor } from '../../src/sectorCopy';
import { strings } from '../../src/strings';
import {
  Banner,
  Body,
  Button,
  Checkbox,
  GroupedList,
  Heading,
  Icon,
  Screen,
  Sheet,
  Small,
  StepHeader,
  TextField,
} from '../../src/ui';
import { MIN_TOUCH_TARGET } from '../../src/ui/constants';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';

const sek = strings.menuScan.ek;

const POLL_INTERVAL_MS = 2000;
// Step EK-4c-1b: a real run takes 100+ seconds (longer for a bigger menu) — the plain progress
// screen alone covers that. SLOW_AFTER_MS only adds a reassuring line once a run runs long even by
// that standard; STUCK_AFTER_MS is the much later point (minutes, not seconds) where something has
// likely actually gone wrong and Retry / Continue without EK suggestions are offered. Both are
// env-overridable so a test can shrink them instead of waiting for real.
const SLOW_AFTER_MS = Number(process.env.EXPO_PUBLIC_EK_SETUP_SLOW_AFTER_MS) || 60_000;
const STUCK_AFTER_MS = Number(process.env.EXPO_PUBLIC_EK_SETUP_STUCK_AFTER_MS) || 360_000;

type Phase = 'starting' | 'progress' | 'ready';

export default function MenuScanEk() {
  const router = useRouter();
  const { status, businesses, authedFetch } = useAuth();
  const params = useLocalSearchParams<{
    businessId?: string;
    scanId?: string;
    returnTo?: string;
    count?: string;
  }>();
  const returnTo = params.returnTo === 'settings' ? 'settings' : 'onboarding';
  const business = businesses.find((b) => String(b.id) === params.businessId) ?? businesses[0];
  const scanId = Number(params.scanId);
  const dishCount = Number(params.count ?? '0');

  const [phase, setPhase] = useState<Phase>('starting');
  const [run, setRun] = useState<EkSetupRun | null>(null);
  const [startError, setStartError] = useState<'unavailable' | 'limit' | 'failed' | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [draft, setDraft] = useState<EkSetupDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [sellItems, setSellItems] = useState<SellItem[] | null>(null);
  const [editingBase, setEditingBase] = useState<EkBaseDraft | null>(null);
  const [addingBase, setAddingBase] = useState(false);
  const [newBaseName, setNewBaseName] = useState('');
  // Step EK-4c-1b: bumped by retryStart to re-run the effect below from scratch — Retry restarts
  // the whole start-and-poll cycle instead of issuing its own separate POST, so a run that failed
  // (or is stuck) resumes exactly the same way a first attempt would, including picking up a
  // "done" result returned instantly by the retried start call.
  const [attempt, setAttempt] = useState(0);
  const stopped = useRef(false);

  // Start (idempotent — a repeat POST just returns the existing run) then poll GET until the run
  // leaves queued/running. Re-runs from scratch whenever `attempt` changes (see retryStart).
  useEffect(() => {
    if (!business || !scanId) return;
    stopped.current = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      if (stopped.current) return;
      try {
        const latest = await authedFetch<EkSetupRun>(
          `/businesses/${business!.id}/ai/menu-scans/${scanId}/ek-setup/`,
        );
        if (stopped.current) return;
        setRun(latest);
        setPhase('progress');
        if (latest.status === 'done' || latest.status === 'failed') return;
      } catch {
        // A transient hiccup mid-poll isn't a failure — just try again next tick.
      }
      setElapsedMs(Date.now() - startedAt);
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    async function start() {
      try {
        const started = await authedFetch<EkSetupRun>(
          `/businesses/${business!.id}/ai/menu-scans/${scanId}/ek-setup/`,
          { method: 'POST' },
        );
        if (stopped.current) return;
        setRun(started);
        setPhase('progress');
        if (started.status === 'done' || started.status === 'failed') return;
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        if (stopped.current) return;
        if (err instanceof ApiError && err.status === 429) setStartError('limit');
        else if (err instanceof ApiError && err.status === 503) setStartError('unavailable');
        else setStartError('failed');
        setPhase('progress');
      }
    }

    start();
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, scanId, attempt]);

  // Once the run is done, resume a saved draft or seed a fresh one from the result.
  useEffect(() => {
    if (!business || !scanId || !run || run.status !== 'done' || draftReady) return;
    setDraftReady(true);
    ekSetupDraftStorage.load(business.id, scanId).then((saved) => {
      if (saved) {
        setDraft(saved);
      } else if (run.best_sellers && run.bases && run.ingredients) {
        setDraft(
          draftFromResult({
            best_sellers: run.best_sellers,
            bases: run.bases,
            families: run.families ?? [],
            ingredients: run.ingredients,
            estimate_note: run.estimate_note ?? '',
            incomplete: Boolean(run.incomplete),
            dishes_without_suggestion: run.dishes_without_suggestion ?? [],
          }),
        );
      }
      setPhase('ready');
    });
  }, [business, scanId, run, draftReady]);

  // Persist every draft change (best-effort, fire-and-forget).
  useEffect(() => {
    if (!business || !scanId || !draft) return;
    ekSetupDraftStorage.save(business.id, scanId, draft);
  }, [business, scanId, draft]);

  useEffect(() => {
    if (!business) return;
    authedFetch<SellItem[]>(`/businesses/${business.id}/sell-items/`)
      .then(setSellItems)
      .catch(() => setSellItems([]));
  }, [business, authedFetch]);

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
  if (!business || !scanId) {
    return <Redirect href="/home" />;
  }

  const sector = sectorCopyFor(business.business_type);
  const donePath = `/menu-scan/done?businessId=${business.id}&returnTo=${returnTo}&count=${dishCount}`;

  function retryStart() {
    setStartError(null);
    setPhase('starting');
    setRun(null);
    setElapsedMs(0);
    setDraftReady(false);
    setAttempt((a) => a + 1);
  }

  // --- Progress / error states -------------------------------------------------------------
  if (startError) {
    const message =
      startError === 'limit'
        ? sek.progress.capReached(sector.sellNounPlural)
        : startError === 'unavailable'
          ? sek.progress.unavailable(sector.sellNounPlural)
          : sek.progress.failed;
    return (
      <Screen>
        <Banner kind={startError === 'failed' ? 'error' : 'warning'}>{message}</Banner>
        <View style={styles.actions}>
          {startError === 'failed' ? (
            <Button label={sek.progress.tryAgain} onPress={retryStart} />
          ) : null}
          <Button
            label={sek.progress.continueWithout}
            variant="secondary"
            onPress={() => router.replace(donePath)}
          />
        </View>
      </Screen>
    );
  }

  if (run?.status === 'failed') {
    return (
      <Screen>
        <Banner kind="error">{sek.progress.failed}</Banner>
        <View style={styles.actions}>
          <Button label={sek.progress.tryAgain} onPress={retryStart} />
          <Button
            label={sek.progress.continueWithout}
            variant="secondary"
            onPress={() => router.replace(donePath)}
          />
        </View>
      </Screen>
    );
  }

  // Only still-queued/running work can be "stuck" — once the run is actually done (or failed,
  // handled above), elapsedMs may still read past STUCK_AFTER_MS from the last tick before the
  // poll loop stopped, but there is nothing left to retry: fall straight through to the batches
  // screen below instead of flashing the stuck banner on the way there.
  const runIsActive = !run || run.status === 'queued' || run.status === 'running';
  if (runIsActive && elapsedMs >= STUCK_AFTER_MS && phase === 'progress') {
    return (
      <Screen>
        <Banner kind="warning">{sek.progress.stuckBanner}</Banner>
        <View style={styles.actions}>
          <Button label={sek.progress.tryAgain} onPress={retryStart} />
          <Button
            label={sek.progress.continueWithout}
            variant="secondary"
            onPress={() => router.replace(donePath)}
          />
        </View>
      </Screen>
    );
  }

  if (phase !== 'ready' || !draft) {
    return (
      <Screen>
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colours.primary} />
          <Heading level={2} style={styles.title}>
            {sek.progress.title}
          </Heading>
          {elapsedMs >= SLOW_AFTER_MS ? (
            <Small style={styles.muted}>{sek.progress.takingAWhile}</Small>
          ) : null}
        </View>
      </Screen>
    );
  }

  // --- Ready: batches (step 1) / best sellers (step 2) --------------------------------------
  function update(mutator: (d: EkSetupDraft) => EkSetupDraft) {
    setDraft((current) => (current ? mutator(current) : current));
  }

  const incompleteNotice =
    draft.dishesWithoutSuggestion.length > 0
      ? sek.progress.incompleteNotice(draft.dishesWithoutSuggestion.length)
      : null;

  if (draft.step === 1) {
    return (
      <Screen
        bottomBar={
          <Button label={sek.batches.continueLabel} onPress={() => update((d) => setStep(d, 2))} />
        }
      >
        <StepHeader current={1} total={4} />
        <Heading level={1}>{sek.batches.title}</Heading>
        <Small style={styles.muted}>{sek.batches.subtitle}</Small>
        {incompleteNotice ? <Banner kind="info">{incompleteNotice}</Banner> : null}

        <View style={styles.list}>
          {draft.bases.map((base) => (
            <BatchRow
              key={base.key}
              base={base}
              onPress={() => setEditingBase(base)}
              onToggleKeep={() => update((d) => toggleBaseKeep(d, base.key))}
            />
          ))}
        </View>

        {addingBase ? (
          <View style={styles.addBaseRow}>
            <TextField
              label={sek.batches.addOwnTitle}
              value={newBaseName}
              onChangeText={setNewBaseName}
              placeholder={sek.batches.addOwnPlaceholder}
            />
            <Button
              label={sek.batches.addOwn}
              onPress={() => {
                if (!newBaseName.trim()) return;
                update((d) => addCustomBase(d, newBaseName));
                setNewBaseName('');
                setAddingBase(false);
              }}
            />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setAddingBase(true)}
            style={styles.addButton}
          >
            <Icon name="plus" size={18} colour={colours.primary} />
            <Body style={styles.addButtonText}>{sek.batches.addOwn}</Body>
          </Pressable>
        )}

        {editingBase ? (
          <BatchDetailSheet
            base={draft.bases.find((b) => b.key === editingBase.key) ?? editingBase}
            draft={draft}
            sellItems={sellItems ?? []}
            onClose={() => setEditingBase(null)}
            onChange={update}
          />
        ) : null}
      </Screen>
    );
  }

  // Step 2: best sellers
  const selectedDishIds = new Set(draft.bestSellers.filter((p) => p.selected).map((p) => p.dishId));
  const bestSellerDishIds = new Set(draft.bestSellers.map((p) => p.dishId));
  const otherDishes = (sellItems ?? []).filter((item) => !bestSellerDishIds.has(item.id));

  return (
    <BestSellersStep
      draft={draft}
      sellItems={sellItems ?? []}
      otherDishes={otherDishes}
      onBack={() => update((d) => setStep(d, 1))}
      onToggle={(key) => update((d) => toggleBestSeller(d, key))}
      onAdd={(dish) => update((d) => addBestSeller(d, dish))}
      onFinish={() => router.replace(donePath)}
      selectedCount={selectedDishIds.size}
    />
  );
}

function BatchRow({
  base,
  onPress,
  onToggleKeep,
}: {
  base: EkBaseDraft;
  onPress: () => void;
  onToggleKeep: () => void;
}) {
  const ingredientNames = base.formula.map((line) => line.name);
  const preview =
    ingredientNames.length > 3
      ? `${ingredientNames.slice(0, 3).join(', ')} + ${ingredientNames.length - 3} more`
      : ingredientNames.join(', ');
  return (
    <View style={[styles.batchRow, !base.keep && styles.batchRowRemoved]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={base.name}
        onPress={onPress}
        style={styles.batchRowMain}
      >
        <Body style={styles.batchName}>{base.name}</Body>
        {preview ? <Small style={styles.batchMeta}>{preview}</Small> : null}
        <Small style={styles.batchMeta}>{sek.batches.usedInDishes(base.dishes.length)}</Small>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${base.keep ? sek.batches.remove : sek.batches.keep} ${base.name}`}
        onPress={onToggleKeep}
        style={[styles.keepChip, base.keep ? styles.keepChipOn : styles.keepChipOff]}
      >
        <Small style={base.keep ? styles.keepChipTextOn : styles.keepChipTextOff}>
          {base.keep ? sek.batches.keep : sek.batches.remove}
        </Small>
      </Pressable>
    </View>
  );
}

function BatchDetailSheet({
  base,
  draft,
  sellItems,
  onClose,
  onChange,
}: {
  base: EkBaseDraft;
  draft: EkSetupDraft;
  sellItems: SellItem[];
  onClose: () => void;
  onChange: (mutator: (d: EkSetupDraft) => EkSetupDraft) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [usedInOpen, setUsedInOpen] = useState(false);

  const usedKeys = new Set(base.formula.map((line) => line.ingredientKey));
  const pickable = draft.ingredients.filter(
    (ing) => !usedKeys.has(ing.key) && ing.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <Sheet visible onClose={onClose} title={base.name}>
      <Small style={styles.muted}>{sek.batches.whatGoesIn}</Small>
      <View style={styles.formulaList}>
        {base.formula.map((line) => (
          <View key={line.id} style={styles.formulaRow}>
            <View style={styles.formulaField}>
              <QuantityInput
                label={line.name}
                quantity={line.amount}
                onQuantityChange={(amount) =>
                  onChange((d) => updateBaseLine(d, base.key, line.id, { amount }))
                }
                entryUnit={line.entryUnit}
                onEntryUnitChange={(entryUnit) =>
                  onChange((d) => updateBaseLine(d, base.key, line.id, { entryUnit }))
                }
                stockItem={unitStockItemFor(
                  draft.ingredients.find((ing) => ing.key === line.ingredientKey)?.unit_family ??
                    'g',
                )}
              />
              <Small style={styles.estimateLabel}>{sek.batches.estimateLabel}</Small>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${sek.batches.removeLine} ${line.name}`}
              onPress={() => onChange((d) => removeBaseLine(d, base.key, line.id))}
              style={styles.formulaRemove}
            >
              <Icon name="delete" size={18} colour={colours.danger} />
            </Pressable>
          </View>
        ))}
      </View>

      {pickerOpen ? (
        <View style={styles.pickerPanel}>
          <TextField
            label={sek.batches.searchIngredients}
            value={search}
            onChangeText={setSearch}
            placeholder={sek.batches.searchIngredients}
          />
          <View style={styles.pickerList}>
            {pickable.map((ing) => (
              <Pressable
                key={ing.key}
                accessibilityRole="button"
                onPress={() => {
                  onChange((d) => addBaseLine(d, base.key, { ingredientKey: ing.key }));
                  setPickerOpen(false);
                  setSearch('');
                }}
                style={styles.pickerChip}
              >
                <Small style={styles.pickerChipText}>{ing.name}</Small>
              </Pressable>
            ))}
          </View>
          <View style={styles.addNewRow}>
            <TextField
              label={sek.batches.addNewIngredient}
              value={newName}
              onChangeText={setNewName}
              placeholder={sek.batches.addNewIngredient}
            />
            <Button
              label={sek.batches.addNewIngredient}
              variant="secondary"
              onPress={() => {
                if (!newName.trim()) return;
                onChange((d) => addBaseLine(d, base.key, { newName }));
                setNewName('');
                setPickerOpen(false);
              }}
            />
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setPickerOpen(true)}
          style={styles.addButton}
        >
          <Icon name="plus" size={18} colour={colours.primary} />
          <Body style={styles.addButtonText}>{sek.batches.addLine}</Body>
        </Pressable>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => setUsedInOpen(true)}
        style={styles.usedInLink}
      >
        <Small style={styles.usedInLinkText}>
          {sek.batches.usedInDishes(base.dishes.length)} · {sek.batches.usedIn}
        </Small>
      </Pressable>

      <Button label={sek.batches.done} onPress={onClose} />

      {usedInOpen ? (
        <UsedInSheet
          base={base}
          sellItems={sellItems}
          onClose={() => setUsedInOpen(false)}
          onChange={onChange}
        />
      ) : null}
    </Sheet>
  );
}

function UsedInSheet({
  base,
  sellItems,
  onClose,
  onChange,
}: {
  base: EkBaseDraft;
  sellItems: SellItem[];
  onClose: () => void;
  onChange: (mutator: (d: EkSetupDraft) => EkSetupDraft) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const usedIds = new Set(base.dishes.map((d) => d.dishId));
  const pickable = sellItems.filter(
    (item) =>
      item.active &&
      !usedIds.has(item.id) &&
      item.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const groups = useMemo(() => {
    const byGroup = new Map<string, typeof base.dishes>();
    for (const dish of base.dishes) {
      const groupName =
        sellItems.find((item) => item.id === dish.dishId)?.group || sek.bestSellers.otherDishes;
      const bucket = byGroup.get(groupName) ?? [];
      bucket.push(dish);
      byGroup.set(groupName, bucket);
    }
    return [...byGroup.entries()].map(([group, items]) => ({ group, items }));
  }, [base, sellItems]);

  return (
    <Sheet visible onClose={onClose} title={sek.batches.usedIn}>
      <Small style={styles.muted}>{sek.batches.usedInSubtitle}</Small>
      {base.dishes.length === 0 ? null : (
        <GroupedList
          groups={groups}
          getKey={(dish) => dish.dishId ?? dish.name}
          renderItem={(dish) => (
            <View style={styles.row}>
              <View style={styles.rowHead}>
                <Body style={styles.rowName}>{dish.name}</Body>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${sek.batches.removeDish} ${dish.name}`}
                  onPress={() =>
                    dish.dishId != null &&
                    onChange((d) => removeUsedInDish(d, base.key, dish.dishId as number))
                  }
                  style={styles.removeButton}
                >
                  <Icon name="delete" size={18} colour={colours.danger} />
                </Pressable>
              </View>
              <TextField
                label={sek.batches.portionLabel}
                value={dish.portion}
                onChangeText={(portion) =>
                  dish.dishId != null &&
                  onChange((d) => updateUsedInPortion(d, base.key, dish.dishId as number, portion))
                }
                keyboardType="decimal-pad"
              />
            </View>
          )}
        />
      )}

      {pickerOpen ? (
        <View style={styles.pickerPanel}>
          <TextField
            label={sek.batches.searchDishes}
            value={search}
            onChangeText={setSearch}
            placeholder={sek.batches.searchDishes}
          />
          <View style={styles.pickerList}>
            {pickable.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => {
                  onChange((d) => addUsedInDish(d, base.key, { dishId: item.id, name: item.name }));
                  setPickerOpen(false);
                  setSearch('');
                }}
                style={styles.pickerChip}
              >
                <Small style={styles.pickerChipText}>{item.name}</Small>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setPickerOpen(true)}
          style={styles.addButton}
        >
          <Icon name="plus" size={18} colour={colours.primary} />
          <Body style={styles.addButtonText}>{sek.batches.addDish}</Body>
        </Pressable>
      )}

      <Button label={sek.batches.done} onPress={onClose} />
    </Sheet>
  );
}

function BestSellersStep({
  draft,
  sellItems,
  otherDishes,
  onBack,
  onToggle,
  onAdd,
  onFinish,
  selectedCount,
}: {
  draft: EkSetupDraft;
  sellItems: SellItem[];
  otherDishes: SellItem[];
  onBack: () => void;
  onToggle: (key: string) => void;
  onAdd: (dish: { dishId: number; name: string }) => void;
  onFinish: () => void;
  selectedCount: number;
}) {
  const [search, setSearch] = useState('');
  const groups = useMemo(() => {
    const byGroup = new Map<string, typeof draft.bestSellers>();
    for (const pick of draft.bestSellers) {
      const groupName =
        sellItems.find((item) => item.id === pick.dishId)?.group || sek.bestSellers.otherDishes;
      const bucket = byGroup.get(groupName) ?? [];
      bucket.push(pick);
      byGroup.set(groupName, bucket);
    }
    return [...byGroup.entries()].map(([group, items]) => ({ group, items }));
  }, [draft, sellItems]);

  const filteredOthers = otherDishes.filter((item) =>
    item.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <Screen bottomBar={<Button label={sek.bestSellers.continueLabel} onPress={onFinish} />}>
      <StepHeader current={2} total={4} onBack={onBack} />
      <Heading level={1}>{sek.bestSellers.title}</Heading>
      <Small style={styles.muted}>{sek.bestSellers.subtitle}</Small>
      <Body style={styles.counter}>{sek.bestSellers.selectedCount(selectedCount)}</Body>

      <GroupedList
        groups={groups}
        getKey={(pick) => pick.key}
        renderItem={(pick) => (
          <Checkbox
            checked={pick.selected}
            onChange={() => onToggle(pick.key)}
            title={pick.name}
            helpText={pick.reason}
          />
        )}
      />

      <TextField
        label={sek.bestSellers.searchPlaceholder}
        value={search}
        onChangeText={setSearch}
        placeholder={sek.bestSellers.searchPlaceholder}
        left={<Icon name="search" size={16} colour={colours.muted} />}
      />
      <View style={styles.list}>
        {filteredOthers.map((item) => (
          <Checkbox
            key={item.id}
            checked={false}
            onChange={() => onAdd({ dishId: item.id, name: item.name })}
            title={item.name}
          />
        ))}
      </View>
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
  centre: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.huge,
  },
  title: {
    textAlign: 'center',
  },
  muted: {
    color: colours.muted,
  },
  actions: {
    gap: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  counter: {
    fontFamily: fonts.bodyExtraBold,
  },
  batchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  batchRowRemoved: {
    opacity: 0.5,
  },
  batchRowMain: {
    flex: 1,
    gap: 2,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  batchName: {
    fontFamily: fonts.bodyExtraBold,
  },
  batchMeta: {
    color: colours.muted,
  },
  keepChip: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: 84,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 2,
  },
  keepChipOn: {
    borderColor: colours.primary,
    backgroundColor: colours.mint,
  },
  keepChipOff: {
    borderColor: colours.danger,
    backgroundColor: colours.card,
  },
  keepChipTextOn: {
    color: colours.text,
    fontFamily: fonts.bodyExtraBold,
  },
  keepChipTextOff: {
    color: colours.danger,
    fontFamily: fonts.bodyExtraBold,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 2,
    borderColor: colours.primary,
    borderRadius: radii.pill,
  },
  addButtonText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
  addBaseRow: {
    gap: spacing.sm,
  },
  formulaList: {
    gap: spacing.md,
  },
  formulaRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  formulaField: {
    flex: 1,
    gap: 2,
  },
  estimateLabel: {
    color: colours.muted,
    fontStyle: 'italic',
  },
  formulaRemove: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerPanel: {
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  pickerList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pickerChip: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.pill,
    backgroundColor: colours.card,
  },
  pickerChipText: {
    color: colours.text,
  },
  addNewRow: {
    gap: spacing.sm,
  },
  usedInLink: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  usedInLinkText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
  row: {
    gap: spacing.xs,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowName: {
    fontFamily: fonts.bodyExtraBold,
  },
  removeButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
