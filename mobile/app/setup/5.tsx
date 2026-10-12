import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { getOnboardingBusiness } from '../../src/business/routing';
import { roleDescription, roleLabel } from '../../src/labels';
import { strings } from '../../src/strings';
import {
  BottomActionBar,
  Body,
  Icon,
  PasswordField,
  Screen,
  Small,
  StepHeader,
  TextField,
} from '../../src/ui';
import { useMinWidth } from '../../src/hooks/useMinWidth';
import { BREAKPOINT_DESKTOP, MIN_TOUCH_TARGET, WIZARD_CONTENT_WIDTH } from '../../src/ui/constants';
import { colours, fonts, radii, spacing, type } from '../../src/theme/tokens';

const s = strings.setup;
const s5 = strings.setup.step5;
const MOBILE_PATTERN = /^[6-9][0-9]{9}$/;
const ROLES = ['manager', 'head_chef', 'helper'] as const;
type Role = (typeof ROLES)[number];

type PersonDraft = {
  name: string;
  mobile: string;
  role: Role | '';
  secret: string;
};

const EMPTY_DRAFT: PersonDraft = { name: '', mobile: '', role: '', secret: '' };

function maskMobile(mobile: string): string {
  return '*'.repeat(Math.max(0, mobile.length - 4)) + mobile.slice(-4);
}

export default function SetupStepFive() {
  const router = useRouter();
  const { status, businesses, authedFetch, refreshMe } = useAuth();
  const onboardingBusiness = getOnboardingBusiness(businesses);
  const twoColumns = useMinWidth(BREAKPOINT_DESKTOP);

  const [addedPeople, setAddedPeople] = useState<PersonDraft[]>([]);
  const [personErrors, setPersonErrors] = useState<Record<number, string>>({});
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<PersonDraft>(EMPTY_DRAFT);
  const [draftErrors, setDraftErrors] = useState<Partial<Record<keyof PersonDraft, string>>>({});
  const [secretVisible, setSecretVisible] = useState(false);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);

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
  const business = onboardingBusiness;

  function resetDraft() {
    setDraft(EMPTY_DRAFT);
    setDraftErrors({});
    setSecretVisible(false);
    setEditingIndex(null);
  }

  function handleAddOrUpdatePerson() {
    const errors: Partial<Record<keyof PersonDraft, string>> = {};
    if (!draft.name.trim()) errors.name = s5.errors.nameRequired;
    if (!MOBILE_PATTERN.test(draft.mobile)) errors.mobile = s5.errors.mobileInvalid;
    if (!draft.role) errors.role = s5.errors.roleRequired;
    if (!draft.secret.trim()) errors.secret = s5.errors.secretRequired;
    setDraftErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const person: PersonDraft = { ...draft, name: draft.name.trim() };
    setAddedPeople((current) => {
      if (editingIndex !== null) {
        const next = [...current];
        next[editingIndex] = person;
        return next;
      }
      return [...current, person];
    });
    resetDraft();
  }

  function handleEditPerson(index: number) {
    setDraft(addedPeople[index]);
    setEditingIndex(index);
    setDraftErrors({});
  }

  function handleRemovePerson(index: number) {
    setAddedPeople((current) => current.filter((_, i) => i !== index));
    setPersonErrors({});
    if (editingIndex === index) resetDraft();
  }

  function mapSubmitError(err: unknown) {
    if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
      setSubmitError(s5.errors.network);
    } else if (err instanceof ApiError) {
      setSubmitError(err.message || s5.errors.generic);
    } else {
      setSubmitError(s5.errors.generic);
    }
  }

  // Each person is its own POST — there's no bulk team endpoint. Anyone who fails stays in the
  // list (with their own error) instead of being discarded; anyone who succeeds is dropped from
  // the pending list, so retrying after a partial failure doesn't re-create people twice.
  async function saveAddedPeople(): Promise<boolean> {
    if (addedPeople.length === 0) return true;
    const remaining: PersonDraft[] = [];
    const errors: Record<number, string> = {};
    let allOk = true;

    for (const person of addedPeople) {
      try {
        await authedFetch(`/businesses/${business.id}/team/`, {
          method: 'POST',
          body: {
            name: person.name,
            mobile: person.mobile,
            role: person.role,
            secret: person.secret,
          },
        });
      } catch (err) {
        allOk = false;
        const message =
          err instanceof ApiError ? err.message || s5.errors.generic : s5.errors.generic;
        errors[remaining.length] = message;
        remaining.push(person);
      }
    }

    setAddedPeople(remaining);
    setPersonErrors(errors);
    return allOk;
  }

  async function save(): Promise<boolean> {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const allSaved = await saveAddedPeople();
      if (!allSaved) {
        setSubmitError(s5.errors.generic);
        return false;
      }
      await authedFetch(`/businesses/${business.id}/onboarding/5/`, {
        method: 'PATCH',
        body: { status: 'done' },
      });
      await authedFetch(`/businesses/${business.id}/`, {
        method: 'PATCH',
        body: { onboarding_step: 6 },
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
    if (await save()) router.push('/setup/6');
  }

  async function handleSaveForLater() {
    if (await save()) router.replace('/home');
  }

  async function handleSkip() {
    setSubmitError(null);
    setSkipping(true);
    try {
      await authedFetch(`/businesses/${business.id}/onboarding/5/`, {
        method: 'PATCH',
        body: { status: 'skipped' },
      });
      await authedFetch(`/businesses/${business.id}/`, {
        method: 'PATCH',
        body: { onboarding_step: 6 },
      });
      await refreshMe();
      router.push('/setup/6');
    } catch (err) {
      mapSubmitError(err);
    } finally {
      setSkipping(false);
    }
  }

  const roleInfo = (
    <View style={styles.field}>
      {ROLES.map((role) => (
        <View key={role} style={styles.roleRow}>
          <Body style={styles.roleName}>{roleLabel(role, business.business_type)}</Body>
          <Small style={styles.roleDescription}>{roleDescription(role)}</Small>
        </View>
      ))}
    </View>
  );

  return (
    <Screen
      maxWidth={WIZARD_CONTENT_WIDTH}
      aside={roleInfo}
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
        current={5}
        total={s.totalSteps}
        onBack={() => router.push('/setup/4')}
        onSaveForLater={handleSaveForLater}
      />

      <Body style={styles.title}>{s5.title}</Body>
      <Small style={styles.intro}>{s5.intro}</Small>

      {submitError ? (
        <View style={styles.formError}>
          <Icon name="error" size={type.md} colour={colours.danger} />
          <Body style={styles.formErrorText}>{submitError}</Body>
        </View>
      ) : null}

      <View style={styles.field}>
        <TextField
          label={s5.nameLabel}
          value={draft.name}
          onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
          placeholder={s5.namePlaceholder}
          autoComplete="name"
          error={draftErrors.name}
        />

        <TextField
          label={s5.mobileLabel}
          value={draft.mobile}
          onChangeText={(mobile) =>
            setDraft((current) => ({ ...current, mobile: mobile.replace(/[^0-9]/g, '') }))
          }
          placeholder={s5.mobilePlaceholder}
          keyboardType="phone-pad"
          autoComplete="tel"
          maxLength={10}
          error={draftErrors.mobile}
        />

        <View style={styles.field}>
          <Small style={styles.roleLabel}>{s5.roleLabel}</Small>
          <View style={styles.roleChips}>
            {ROLES.map((role) => {
              const selected = draft.role === role;
              return (
                <Pressable
                  key={role}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => setDraft((current) => ({ ...current, role }))}
                  style={[styles.roleChip, selected ? styles.roleChipSelected : null]}
                >
                  <Small style={selected ? styles.roleChipTextSelected : styles.roleChipText}>
                    {roleLabel(role, business.business_type)}
                  </Small>
                </Pressable>
              );
            })}
          </View>
          {draftErrors.role ? (
            <View style={styles.formError}>
              <Icon name="error" size={type.sm} colour={colours.danger} />
              <Small style={styles.formErrorText}>{draftErrors.role}</Small>
            </View>
          ) : null}
        </View>

        {draft.role === 'manager' ? (
          <PasswordField
            label={s5.temporaryPasswordLabel}
            value={draft.secret}
            onChangeText={(secret) => setDraft((current) => ({ ...current, secret }))}
            autoComplete="new-password"
            hint={draftErrors.secret ? undefined : s5.temporaryPasswordHint}
            error={draftErrors.secret}
          />
        ) : (
          <TextField
            label={s5.pinLabel}
            value={draft.secret}
            onChangeText={(secret) =>
              setDraft((current) => ({ ...current, secret: secret.replace(/[^0-9]/g, '') }))
            }
            secureTextEntry={!secretVisible}
            keyboardType="number-pad"
            maxLength={6}
            hint={draftErrors.secret ? undefined : s5.pinHint}
            error={draftErrors.secret}
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={secretVisible ? 'Hide PIN' : 'Show PIN'}
                onPress={() => setSecretVisible((current) => !current)}
                style={styles.secretToggle}
              >
                <Small style={styles.secretToggleText}>{secretVisible ? 'Hide' : 'Show'}</Small>
              </Pressable>
            }
          />
        )}

        {draft.role ? <Small style={styles.reminder}>{s5.secretReminder}</Small> : null}

        <Pressable
          accessibilityRole="button"
          onPress={handleAddOrUpdatePerson}
          style={styles.addButton}
        >
          <Body style={styles.addButtonText}>{s5.addPerson}</Body>
        </Pressable>
      </View>

      {addedPeople.length > 0 ? (
        <View style={styles.field}>
          <Body style={styles.sectionLabel}>{s5.addedPeople}</Body>
          <View style={twoColumns ? styles.personGrid : styles.field}>
            {addedPeople.map((person, index) => (
              <View
                key={`${person.mobile}-${index}`}
                style={[styles.personRow, twoColumns ? styles.personRowHalf : null]}
              >
                <View style={styles.personRowCopy}>
                  <Body style={styles.personRowName}>{person.name}</Body>
                  <Small style={styles.personRowMeta}>
                    {roleLabel(person.role, business.business_type)} · {maskMobile(person.mobile)}
                  </Small>
                  {personErrors[index] ? (
                    <Small style={styles.formErrorText}>{personErrors[index]}</Small>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${s5.edit} ${person.name}`}
                  onPress={() => handleEditPerson(index)}
                  style={styles.personAction}
                >
                  <Icon name="edit" size={18} colour={colours.primary} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${s5.remove} ${person.name}`}
                  onPress={() => handleRemovePerson(index)}
                  style={styles.personAction}
                >
                  <Icon name="delete" size={18} colour={colours.danger} />
                </Pressable>
              </View>
            ))}
          </View>
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
  intro: {
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
  roleRow: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  roleName: {
    fontFamily: fonts.bodyExtraBold,
  },
  roleDescription: {
    color: colours.muted,
  },
  roleLabel: {
    fontFamily: fonts.bodyExtraBold,
  },
  roleChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  roleChip: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.pill,
    backgroundColor: colours.card,
  },
  roleChipSelected: {
    borderColor: colours.primary,
    backgroundColor: colours.mint,
  },
  roleChipText: {
    color: colours.text,
  },
  roleChipTextSelected: {
    color: colours.text,
    fontFamily: fonts.bodyExtraBold,
  },
  secretToggle: {
    minWidth: spacing.huge + spacing.xl,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  secretToggleText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
  reminder: {
    color: colours.warning,
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
  personGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  // Two per row at 900px+ — a percentage width, not a fixed pixel one, so it still shrinks cleanly
  // with the wrapping `personGrid` gap rather than overflowing it.
  personRowHalf: {
    flexBasis: '48%',
    minWidth: 0,
  },
  personRowCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  personRowName: {
    fontFamily: fonts.bodyExtraBold,
  },
  personRowMeta: {
    color: colours.muted,
  },
  personAction: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
