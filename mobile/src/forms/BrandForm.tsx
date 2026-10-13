import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { Business } from '../api/business';
import { ApiError, type RequestOptions } from '../api/client';
import { BRAND_COLOUR_PRESETS } from '../constants/brandColours';
import { strings } from '../strings';
import { ensureContrast } from '../theme/brand';
import { Body, Icon, Muted, Small } from '../ui';
import { MIN_TOUCH_TARGET } from '../ui/constants';
import { colours, fonts, radii, spacing, type } from '../theme/tokens';

const s2 = strings.setup.step2;
const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function normaliseHex(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

type Props = {
  business: Business;
  authedFetch: <T>(path: string, options?: RequestOptions) => Promise<T>;
  colour: string;
  onColourChange: (colour: string, adjusted: boolean) => void;
  logoUri: string | undefined;
  onLogoChange: (uri: string | undefined) => void;
  onError: (message: string) => void;
};

/** The logo + brand colour fields shared by setup/2 and Settings' "Brand" screen, including the
 * white-text contrast rule and the immediate (not deferred-to-Save) logo upload. No Save/Next
 * button here — the caller owns that. */
export function BrandForm({
  business,
  authedFetch,
  colour,
  onColourChange,
  logoUri,
  onLogoChange,
  onError,
}: Props) {
  const [customHex, setCustomHex] = useState('');
  const [customError, setCustomError] = useState<string | undefined>();
  const [colourAdjusted, setColourAdjusted] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  function pickPreset(hex: string) {
    setCustomHex('');
    setCustomError(undefined);
    setColourAdjusted(false);
    onColourChange(hex, false);
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
    setColourAdjusted(result.changed);
    onColourChange(result.colour, result.changed);
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
    const previousUri = logoUri;
    onLogoChange(asset.uri);
    setLogoUploading(true);
    try {
      const blob = await (await fetch(asset.uri)).blob();
      const formData = new FormData();
      formData.append('logo', blob, asset.fileName ?? 'logo.jpg');
      const updated = await authedFetch<Business>(`/businesses/${business.id}/logo/`, {
        method: 'POST',
        body: formData,
      });
      onLogoChange(updated.logo ?? asset.uri);
    } catch (err) {
      if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
        onError(s2.errors.network);
      } else if (err instanceof ApiError) {
        onError(err.message || s2.errors.invalidLogoFile);
      } else {
        onError(s2.errors.invalidLogoFile);
      }
      onLogoChange(previousUri);
    } finally {
      setLogoUploading(false);
    }
  }

  function handleRemoveLogo() {
    // Clears the preview only — there's no delete-logo endpoint yet, so a previously uploaded file
    // still exists on the business; picking a new one replaces it either way.
    onLogoChange(undefined);
  }

  return (
    <View style={styles.field}>
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
    </View>
  );
}

const SWATCH_SIZE = MIN_TOUCH_TARGET;

const styles = StyleSheet.create({
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
});
