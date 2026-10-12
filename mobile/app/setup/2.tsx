import * as ImagePicker from 'expo-image-picker';
import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { Business } from '../../src/api/business';
import { ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { getOnboardingBusiness } from '../../src/business/routing';
import { BRAND_COLOUR_PRESETS } from '../../src/constants/brandColours';
import { strings } from '../../src/strings';
import { bestTextOn, ensureContrast } from '../../src/theme/brand';
import { BottomActionBar, Body, Icon, Muted, Screen, Small, StepHeader } from '../../src/ui';
import { MIN_TOUCH_TARGET, WIZARD_CONTENT_WIDTH } from '../../src/ui/constants';
import { colours, fonts, radii, spacing, type } from '../../src/theme/tokens';

const s = strings.setup;
const s2 = strings.setup.step2;
const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function normaliseHex(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

export default function SetupStepTwo() {
  const router = useRouter();
  const { status, businesses, authedFetch, refreshMe } = useAuth();
  const existing = getOnboardingBusiness(businesses);

  const [colour, setColour] = useState(existing?.primary_colour ?? '#1F6F63');
  const [colourAdjusted, setColourAdjusted] = useState(false);
  const [customHex, setCustomHex] = useState('');
  const [customError, setCustomError] = useState<string | undefined>();
  const [logoUri, setLogoUri] = useState<string | undefined>(existing?.logo ?? undefined);
  const [logoUploading, setLogoUploading] = useState(false);
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
  if (!existing) {
    return <Redirect href="/setup/1" />;
  }
  // A plain `const` so the functions below (called later, asynchronously) keep TypeScript's
  // non-null narrowing — `existing` itself loses it once captured in a closure.
  const business = existing;

  function pickPreset(hex: string) {
    setCustomHex('');
    setCustomError(undefined);
    setColourAdjusted(false);
    setColour(hex);
  }

  function handleCustomHexChange(text: string) {
    setCustomHex(text);
    const normalised = normaliseHex(text);
    if (normalised.length < 7) {
      setCustomError(undefined);
      return;
    }
    if (!HEX_PATTERN.test(normalised)) {
      setCustomError(s2.errors.invalidColour);
      return;
    }
    setCustomError(undefined);
    const result = ensureContrast(normalised);
    setColour(result.colour);
    setColourAdjusted(result.changed);
  }

  function mapError(err: unknown, fallback: string) {
    if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
      setFormError(s2.errors.network);
    } else if (err instanceof ApiError) {
      setFormError(err.message || fallback);
    } else {
      setFormError(fallback);
    }
  }

  async function handlePickLogo() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0];
    setFormError(null);
    setLogoUri(asset.uri);
    setLogoUploading(true);
    try {
      const blob = await (await fetch(asset.uri)).blob();
      const formData = new FormData();
      formData.append('logo', blob, asset.fileName ?? 'logo.jpg');
      const updated = await authedFetch<Business>(`/businesses/${business.id}/logo/`, {
        method: 'POST',
        body: formData,
      });
      setLogoUri(updated.logo ?? asset.uri);
      await refreshMe();
    } catch (err) {
      mapError(err, s2.errors.invalidLogoFile);
      setLogoUri(business.logo ?? undefined);
    } finally {
      setLogoUploading(false);
    }
  }

  function handleRemoveLogo() {
    // Clears the preview only — there's no delete-logo endpoint yet, so a previously uploaded
    // file still exists on the business; picking a new one replaces it either way.
    setLogoUri(undefined);
  }

  async function save(nextStep: number): Promise<boolean> {
    setFormError(null);
    setSubmitting(true);
    try {
      await authedFetch<Business>(`/businesses/${business.id}/`, {
        method: 'PATCH',
        body: { primary_colour: colour, onboarding_step: nextStep },
      });
      await authedFetch(`/businesses/${business.id}/onboarding/2/`, {
        method: 'PATCH',
        body: { status: 'done' },
      });
      await refreshMe();
      return true;
    } catch (err) {
      mapError(err, s2.errors.generic);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNext() {
    if (await save(3)) router.push('/setup/3');
  }

  async function handleSaveForLater() {
    if (await save(3)) router.replace('/home');
  }

  const previewTextColour = bestTextOn(colour);

  const preview = (
    <View style={styles.field}>
      <Body style={styles.label}>{s2.previewLabel}</Body>
      <View style={styles.phone}>
        <View style={[styles.phoneHeader, { backgroundColor: colour }]}>
          {logoUri ? (
            <Image source={{ uri: logoUri }} style={styles.phoneLogo} />
          ) : (
            <View style={styles.phoneLogoPlaceholder} />
          )}
          <Body style={[styles.phoneName, { color: previewTextColour }]}>{existing.name}</Body>
        </View>
        <View style={styles.phoneBody}>
          <Muted size="sm">Today&rsquo;s stock</Muted>
        </View>
      </View>
    </View>
  );

  return (
    <Screen
      maxWidth={WIZARD_CONTENT_WIDTH}
      aside={preview}
      bottomBar={
        <BottomActionBar
          primaryLabel={s.next}
          onPrimaryPress={handleNext}
          primaryLoading={submitting}
        />
      }
    >
      <StepHeader
        current={2}
        total={s.totalSteps}
        onBack={() => router.push('/setup/1')}
        onSaveForLater={handleSaveForLater}
      />

      <Body style={styles.title}>{s2.title}</Body>

      {formError ? (
        <View style={styles.formError}>
          <Icon name="error" size={type.md} colour={colours.danger} />
          <Body style={styles.formErrorText}>{formError}</Body>
        </View>
      ) : null}

      <View style={styles.field}>
        <Body style={styles.label}>{s2.logoLabel}</Body>
        <View style={styles.logoRow}>
          <View style={styles.logoPreview}>
            {logoUri ? <Image source={{ uri: logoUri }} style={styles.logoImage} /> : null}
          </View>
          <View style={styles.logoActions}>
            <Pressable
              accessibilityRole="button"
              onPress={handlePickLogo}
              style={styles.logoButton}
            >
              <Small style={styles.logoButtonText}>{logoUploading ? '…' : s2.addLogo}</Small>
            </Pressable>
            {logoUri ? (
              <Pressable
                accessibilityRole="button"
                onPress={handleRemoveLogo}
                style={styles.logoButton}
              >
                <Small style={styles.removeText}>{s2.removeLogo}</Small>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.field}>
        <Body style={styles.label}>{s2.colourLabel}</Body>
        <View style={styles.swatchRow}>
          {BRAND_COLOUR_PRESETS.map((hex) => {
            const selected = colour === hex && !customHex;
            return (
              <Pressable
                key={hex}
                accessibilityRole="radio"
                accessibilityLabel={hex}
                accessibilityState={{ checked: selected }}
                onPress={() => pickPreset(hex)}
                style={[
                  styles.swatch,
                  { backgroundColor: hex },
                  selected ? styles.swatchSelected : null,
                ]}
              >
                {selected ? (
                  <Icon name="success" size={16} colour={colours.card} strokeWidth={3} />
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <Small style={styles.label}>{s2.customColourLabel}</Small>
        <TextInput
          value={customHex}
          onChangeText={handleCustomHexChange}
          placeholder={s2.customColourPlaceholder}
          placeholderTextColor={colours.muted}
          autoCapitalize="characters"
          style={styles.hexInput}
          aria-label={s2.customColourLabel}
        />
        {customError ? (
          <View style={styles.formError}>
            <Icon name="error" size={type.md} colour={colours.danger} />
            <Body style={styles.formErrorText}>{customError}</Body>
          </View>
        ) : colourAdjusted ? (
          <Muted size="sm">{s2.colourAdjustedNotice}</Muted>
        ) : null}
      </View>
    </Screen>
  );
}

const SWATCH_SIZE = MIN_TOUCH_TARGET;

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
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  logoPreview: {
    width: 72,
    height: 72,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colours.mint,
    backgroundColor: colours.card,
    overflow: 'hidden',
  },
  logoImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  logoActions: {
    gap: spacing.sm,
  },
  logoButton: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  logoButtonText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
    textDecorationLine: 'underline',
  },
  removeText: {
    color: colours.danger,
    fontFamily: fonts.bodyExtraBold,
    textDecorationLine: 'underline',
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  swatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: {
    borderColor: colours.text,
  },
  hexInput: {
    minHeight: 52,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colours.card,
    color: colours.text,
    fontFamily: fonts.body,
    fontSize: type.md,
  },
  phone: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colours.card,
  },
  phoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  phoneLogo: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
  },
  phoneLogoPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  phoneName: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: type.md,
  },
  phoneBody: {
    padding: spacing.lg,
  },
});
