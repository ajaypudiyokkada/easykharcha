import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ApiError } from '../src/api/client';
import type { CountFormItem, CountsTodayStatus, CountType } from '../src/api/counts';
import { useAuth } from '../src/auth/AuthContext';
import { can } from '../src/auth/permissions';
import { defaultEntryUnit, QuantityInput } from '../src/forms/QuantityInput';
import { countDraftStorage, type CountDraftLine } from '../src/screens/countDraftStorage';
import { formatDateTime } from '../src/format';
import { sectorCopyFor } from '../src/sectorCopy';
import { strings } from '../src/strings';
import { colours, fonts, radii, spacing } from '../src/theme/tokens';
import {
  AppShell,
  Body,
  Button,
  Heading,
  Icon,
  NoAccess,
  ReadError,
  Screen,
  SkeletonList,
  Small,
} from '../src/ui';
import { HOME_CONTENT_WIDTH } from '../src/ui/constants';

const s = strings.count;

type LineState = {
  countedQty: string;
  entryUnit: string | null;
  notSure: boolean;
  skipped: boolean;
};

function emptyLine(): LineState {
  return { countedQty: '', entryUnit: null, notSure: false, skipped: false };
}

function isDone(line: LineState): boolean {
  return line.skipped || line.countedQty.trim() !== '';
}

export default function Count() {
  const router = useRouter();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [countType, setCountType] = useState<CountType | null>(null);
  const [bothDone, setBothDone] = useState(false);
  const [locked, setLocked] = useState(false);
  const [today, setToday] = useState<CountsTodayStatus | null>(null);
  const [items, setItems] = useState<CountFormItem[]>([]);
  const [lines, setLines] = useState<Record<number, LineState>>({});
  const [guardItemId, setGuardItemId] = useState<number | null>(null);
  const [confirmIds, setConfirmIds] = useState<Set<number>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resumedDraft, setResumedDraft] = useState(false);
  const hydrated = useRef(false);

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    setFailed(false);
    setLocked(false);
    try {
      const todayStatus = await authedFetch<CountsTodayStatus>(
        `/businesses/${business.id}/counts/today/`,
      );
      setToday(todayStatus);
      if (todayStatus.next_action === 'none') {
        setBothDone(true);
        setLoading(false);
        return;
      }
      const nextType: CountType = todayStatus.next_action;
      // Defensive: next_action only ever resolves to 'closing' once it's unlocked, but if it's
      // somehow still locked, explain why instead of rendering a form nobody can submit.
      if (nextType === 'closing' && todayStatus.closing.state === 'locked') {
        setLocked(true);
        setLoading(false);
        return;
      }
      setCountType(nextType);
      const form = await authedFetch<{ items: CountFormItem[] }>(
        `/businesses/${business.id}/counts/form/?type=${nextType}`,
      );
      setItems(form.items);

      const draft = await countDraftStorage.load(business.id, nextType);
      const initial: Record<number, LineState> = {};
      for (const item of form.items) {
        const draftLine = draft?.lines.find((l: CountDraftLine) => l.stockItem === item.id);
        initial[item.id] = draftLine
          ? {
              countedQty: draftLine.countedQty,
              entryUnit: draftLine.entryUnit,
              notSure: draftLine.state === 'not_sure',
              skipped: draftLine.state === 'skipped',
            }
          : { ...emptyLine(), entryUnit: defaultEntryUnit(item) };
      }
      setLines(initial);
      setResumedDraft(Boolean(draft));
      hydrated.current = true;
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Persists on every change, once the initial load/hydration has happened — so a save failure,
  // a closed tab, or a phone call never loses what was already typed.
  useEffect(() => {
    if (!business || !countType || !hydrated.current) return;
    const draftLines: CountDraftLine[] = items.map((item) => {
      const line = lines[item.id] ?? emptyLine();
      return {
        stockItem: item.id,
        state: line.skipped ? 'skipped' : line.notSure ? 'not_sure' : 'counted',
        countedQty: line.countedQty,
        entryUnit: line.entryUnit,
      };
    });
    countDraftStorage.save({ businessId: business.id, countType, lines: draftLines });
  }, [lines, items, business, countType]);

  if (status === 'bootstrapping') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }
  if (status === 'signedOut' || !user) {
    return <Redirect href="/login" />;
  }
  if (!can(permissions, 'counts.create')) {
    return (
      <AppShell active="home">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  function updateLine(itemId: number, patch: Partial<LineState>) {
    setLines((current) => ({
      ...current,
      [itemId]: { ...(current[itemId] ?? emptyLine()), ...patch },
    }));
  }

  function step(itemId: number, delta: number) {
    const line = lines[itemId] ?? emptyLine();
    const next = Math.max(0, (parseFloat(line.countedQty) || 0) + delta);
    updateLine(itemId, { countedQty: String(next), skipped: false });
  }

  const isFirstCount = Boolean(today?.is_first_count);
  const doneCount = items.filter((item) => isDone(lines[item.id] ?? emptyLine())).length;
  const allDone = items.length > 0 && (isFirstCount ? doneCount >= 1 : doneCount === items.length);

  async function submit(extraConfirmIds?: Set<number>) {
    if (!business || !countType) return;
    setFormError(null);
    setSaving(true);
    const confirmSet = extraConfirmIds ?? confirmIds;
    try {
      const payload = {
        type: countType,
        confirm_ids: Array.from(confirmSet),
        lines: items.map((item) => {
          const line = lines[item.id] ?? emptyLine();
          // A first count can be saved with items left untouched — they're sent as skipped
          // rather than left out, so the server still sees every active item addressed.
          const skipped = line.skipped || (isFirstCount && !isDone(line));
          const state = skipped ? 'skipped' : line.notSure ? 'not_sure' : 'counted';
          return {
            stock_item: item.id,
            state,
            counted_qty: skipped ? null : line.countedQty.trim() || null,
            entry_unit: skipped ? null : line.entryUnit,
          };
        }),
      };
      await authedFetch(`/businesses/${business.id}/counts/`, { method: 'POST', body: payload });
      await countDraftStorage.clear(business.id, countType);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'needs_confirmation' && err.itemIds?.length) {
        setGuardItemId(err.itemIds[0]);
      } else if (err instanceof ApiError && err.kind === 'offline') {
        setFormError(s.errors.offline);
      } else if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
        setFormError(s.errors.network);
      } else {
        setFormError(s.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  function confirmGuard() {
    if (guardItemId == null) return;
    const nextConfirmed = new Set(confirmIds);
    nextConfirmed.add(guardItemId);
    setConfirmIds(nextConfirmed);
    setGuardItemId(null);
    submit(nextConfirmed);
  }

  if (saved) {
    return (
      <AppShell active="home">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <View style={styles.savedWrap}>
            <View style={styles.savedIcon}>
              <Icon name="success" size={32} colour={colours.card} />
            </View>
            <Heading level={1}>{s.savedTitle}</Heading>
            <Body style={styles.savedBody}>{s.savedBody}</Body>
            <Button
              label={s.backToToday}
              variant="primary"
              onPress={() => router.replace('/home')}
            />
          </View>
        </Screen>
      </AppShell>
    );
  }

  const guardItem = items.find((item) => item.id === guardItemId);
  const guardLine = guardItem ? lines[guardItem.id] : undefined;
  const guardValue = guardLine?.countedQty ?? '';
  const guardUnit = guardLine?.entryUnit || guardItem?.unit || '';

  return (
    <AppShell active="home">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{isFirstCount ? s.startingStockTitle : s.title}</Heading>
        <Body style={styles.subtitle}>
          {sectorCopyFor(business?.business_type ?? '').countHelp}
        </Body>

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading ? (
          <SkeletonList count={4} height={140} />
        ) : bothDone ? (
          <View style={styles.doneWrap}>
            <Heading level={3}>{s.bothDoneTitle}</Heading>
            {today?.opening.done_at && today.opening.by ? (
              <Body style={styles.subtitle}>
                {s.doneAt(
                  'Opening',
                  formatDateTime(today.opening.done_at, business?.timezone ?? 'Asia/Kolkata'),
                  today.opening.by,
                )}
              </Body>
            ) : null}
            {today?.closing.done_at && today.closing.by ? (
              <Body style={styles.subtitle}>
                {s.doneAt(
                  'Closing',
                  formatDateTime(today.closing.done_at, business?.timezone ?? 'Asia/Kolkata'),
                  today.closing.by,
                )}
              </Body>
            ) : null}
          </View>
        ) : locked ? (
          <View style={styles.doneWrap}>
            <Heading level={3}>{s.lockedTitle}</Heading>
            <Body style={styles.subtitle}>{s.lockedBody}</Body>
            <Button label={s.lockedButton} variant="primary" onPress={load} />
          </View>
        ) : (
          <>
            {resumedDraft ? <Small style={styles.resumedNote}>{s.draftResumed}</Small> : null}
            {countType === 'closing' && today?.closing.missing_opening ? (
              <Small style={styles.resumedNote}>{s.missingOpeningNote}</Small>
            ) : null}
            {isFirstCount ? (
              <View style={styles.introCard}>
                <Body style={styles.introText}>{s.startingStockIntro}</Body>
              </View>
            ) : null}
            <View style={styles.progressCard}>
              <Small style={styles.progressLabel}>{s.progress(doneCount, items.length)}</Small>
              <Small style={styles.progressHint}>{s.progressHint}</Small>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${items.length ? (doneCount / items.length) * 100 : 0}%` },
                  ]}
                />
              </View>
            </View>

            {formError ? <Small style={styles.errorText}>{formError}</Small> : null}

            {items.map((item) => {
              const line = lines[item.id] ?? emptyLine();
              return (
                <View key={item.id} style={styles.card}>
                  <Heading level={3}>{item.name}</Heading>
                  <View style={styles.qtyRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Decrease ${item.name}`}
                      onPress={() => step(item.id, -1)}
                      style={styles.qtyBtn}
                    >
                      <Icon name="minus" size={18} colour={colours.text} />
                    </Pressable>
                    <View style={styles.qtyInputWrap}>
                      <QuantityInput
                        label={s.quantityLabel(item.name)}
                        quantity={line.countedQty}
                        onQuantityChange={(text) =>
                          updateLine(item.id, { countedQty: text, skipped: false })
                        }
                        entryUnit={line.entryUnit}
                        onEntryUnitChange={(unit) => updateLine(item.id, { entryUnit: unit })}
                        stockItem={item}
                        missingPackSizeHint={s.missingPackSizeHint}
                      />
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Increase ${item.name}`}
                      onPress={() => step(item.id, 1)}
                      style={styles.qtyBtn}
                    >
                      <Icon name="plus" size={18} colour={colours.text} />
                    </Pressable>
                  </View>
                  <View style={styles.optionsRow}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: line.notSure }}
                      onPress={() => updateLine(item.id, { notSure: !line.notSure })}
                      style={[styles.optionChip, line.notSure ? styles.optionChipActive : null]}
                    >
                      <Small style={line.notSure ? styles.optionTextActive : styles.optionText}>
                        {s.notSure}
                      </Small>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => updateLine(item.id, { skipped: true, countedQty: '' })}
                      style={[styles.optionChip, line.skipped ? styles.optionChipActive : null]}
                    >
                      <Small style={line.skipped ? styles.optionTextActive : styles.optionText}>
                        {line.skipped ? s.skipped : s.skipForNow}
                      </Small>
                    </Pressable>
                  </View>
                </View>
              );
            })}

            {!allDone ? (
              <Small style={styles.errorText}>
                {isFirstCount ? s.saveReasonFirst : s.saveReason}
              </Small>
            ) : null}
            <Button
              label={s.save}
              variant="primary"
              onPress={() => submit()}
              disabled={!allDone}
              loading={saving}
            />
          </>
        )}
      </Screen>

      {guardItem ? (
        <View style={styles.guardOverlay}>
          <View style={styles.guardDialog}>
            <Heading level={3}>{s.guardTitle}</Heading>
            <Body style={styles.guardQuestion}>{s.guardQuestion(guardValue, guardUnit)}</Body>
            <Button
              label={s.guardYes(guardValue, guardUnit)}
              variant="primary"
              onPress={confirmGuard}
            />
            <Button label={s.guardFix} variant="link" onPress={() => setGuardItemId(null)} />
          </View>
        </View>
      ) : null}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  subtitle: {
    color: colours.muted,
  },
  doneWrap: {
    gap: spacing.sm,
  },
  resumedNote: {
    color: colours.muted,
  },
  introCard: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    backgroundColor: colours.mint,
    padding: spacing.lg,
  },
  introText: {
    color: colours.text,
  },
  progressCard: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  progressLabel: {
    fontFamily: fonts.bodyExtraBold,
  },
  progressHint: {
    color: colours.muted,
  },
  progressTrack: {
    height: 10,
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colours.primary,
  },
  card: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  qtyBtn: {
    width: 48,
    height: 48,
    // Roughly lines up with QuantityInput's own number field, below its label.
    marginTop: 28,
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyInputWrap: {
    flex: 1,
    // Without an explicit minWidth, a bare <input>'s own intrinsic min-content size (react-native-web
    // renders TextInput as one) wins over flex:1's shrink — the classic flexbox input-overflow trap.
    minWidth: 0,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  optionChip: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
  },
  optionChipActive: {
    backgroundColor: colours.primary,
  },
  optionText: {
    color: colours.text,
    fontFamily: fonts.bodyExtraBold,
  },
  optionTextActive: {
    color: colours.card,
    fontFamily: fonts.bodyExtraBold,
  },
  errorText: {
    color: colours.danger,
    fontFamily: fonts.bodyExtraBold,
  },
  savedWrap: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  savedIcon: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    backgroundColor: colours.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  savedBody: {
    color: colours.muted,
    textAlign: 'center',
  },
  guardOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(34,49,46,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  guardDialog: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colours.card,
    borderRadius: radii.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  guardQuestion: {
    color: colours.muted,
  },
});
