import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';

import { ApiError } from '../../src/api/client';
import type { MenuScanCreateResponse } from '../../src/api/menuScan';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { pickFiles } from '../../src/forms/filePicker';
import {
  MAX_IMAGE_BYTES,
  MAX_PHOTOS,
  resizeImageForUpload,
  validateImageType,
  validatePdfFile,
} from '../../src/forms/menuFileValidation';
import { menuScanDraft, type MenuScanReturnTo } from '../../src/screens/menuScanDraft';
import { sectorCopyFor } from '../../src/sectorCopy';
import { strings } from '../../src/strings';
import { Banner, Button, Heading, Icon, Screen, Small } from '../../src/ui';
import { MIN_TOUCH_TARGET } from '../../src/ui/constants';
import { colours, fonts, radii, spacing, type } from '../../src/theme/tokens';

const sm = strings.menuScan.source;
const se = strings.menuScan.analyzing.errors;

type PickedImage = { file: File; previewUrl: string };
type BlockedReason = 'unavailable' | 'limit' | null;

export default function MenuScanSource() {
  const router = useRouter();
  const { status, businesses, authedFetch } = useAuth();
  const params = useLocalSearchParams<{ businessId?: string; returnTo?: string }>();
  const returnTo: MenuScanReturnTo = params.returnTo === 'settings' ? 'settings' : 'onboarding';
  // Step O1: the fork (not step 4, which no longer offers scan/manual) is what launches this flow
  // from onboarding now, so "Back" here returns there.
  const backPath = returnTo === 'settings' ? '/settings/sell' : '/setup/fork';

  const [images, setImages] = useState<PickedImage[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockedReason>(null);
  const [submitting, setSubmitting] = useState(false);

  const business = businesses.find((b) => String(b.id) === params.businessId) ?? businesses[0];
  const sector = business ? sectorCopyFor(business.business_type) : null;
  const allowed = Boolean(
    business && sector?.menuScanEnabled && can(business.permissions, 'sellitems.manage'),
  );

  useEffect(() => {
    if (!business || !allowed) return;
    menuScanDraft.load(business.id).then((draft) => {
      if (draft) {
        router.replace(`/menu-scan/analyzing?businessId=${business.id}&returnTo=${draft.returnTo}`);
      }
    });
    // Checks once per mount, for this business, whether a scan is already in progress to resume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, allowed]);

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
  if (!business || !sector || !allowed) {
    return <Redirect href="/home" />;
  }
  const noun = sector.menuNoun;

  async function addPhotos(files: File[]) {
    setError(null);
    const remaining = MAX_PHOTOS - images.length;
    const overflow = files.length > remaining;
    const toProcess = files.slice(0, remaining);

    const accepted: PickedImage[] = [];
    let hadWrongType = false;
    let hadTooBig = false;
    for (const file of toProcess) {
      if (validateImageType(file)) {
        hadWrongType = true;
        continue;
      }
      const resized = await resizeImageForUpload(file);
      if (resized.size > MAX_IMAGE_BYTES) {
        hadTooBig = true;
        continue;
      }
      accepted.push({ file: resized, previewUrl: URL.createObjectURL(resized) });
    }

    if (accepted.length > 0) {
      setPdf(null);
      setImages((current) => [...current, ...accepted]);
    }
    if (overflow) setError(sm.errors.tooMany);
    else if (hadTooBig) setError(sm.errors.tooBig);
    else if (hadWrongType) setError(sm.errors.wrongType);
  }

  function addPdf(files: File[]) {
    setError(null);
    const file = files[0];
    if (!file) return;
    const problem = validatePdfFile(file);
    if (problem === 'wrong_type') {
      setError(sm.errors.wrongType);
      return;
    }
    if (problem === 'too_big') {
      setError(sm.errors.pdfTooBig);
      return;
    }
    setImages([]);
    setPdf(file);
  }

  function removeImage(index: number) {
    setImages((current) => current.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!business || (images.length === 0 && !pdf)) return;
    setSubmitting(true);
    setError(null);
    setBlocked(null);
    try {
      const formData = new FormData();
      if (pdf) {
        formData.append('pdf', pdf, pdf.name);
      } else {
        for (const image of images) formData.append('images', image.file, image.file.name);
      }
      const scan = await authedFetch<MenuScanCreateResponse>(
        `/businesses/${business.id}/ai/menu-scans/`,
        { method: 'POST', body: formData },
      );
      await menuScanDraft.save({ businessId: business.id, scanId: scan.id, returnTo });
      router.push(`/menu-scan/analyzing?businessId=${business.id}&returnTo=${returnTo}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setBlocked('unavailable');
      } else if (err instanceof ApiError && err.status === 429) {
        setBlocked('limit');
      } else if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
        setError(sm.errors.network);
      } else if (err instanceof ApiError) {
        setError(err.message || sm.errors.generic);
      } else {
        setError(sm.errors.generic);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // AI unavailable/rate-limited: continue the wizard at brand (step 2) rather than back to the
  // fork — scanning runs before brand in the quick path, so this just rejoins the normal order.
  const manualPath = returnTo === 'onboarding' ? '/setup/2' : backPath;

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.replace(backPath)}
          style={styles.backBtn}
        >
          <Icon name="back" size={22} colour={colours.text} />
        </Pressable>
        <Heading level={2}>{sm.title(noun)}</Heading>
      </View>
      <Small style={styles.subtitle}>{sm.intro(noun)}</Small>

      {error ? <Banner kind="error">{error}</Banner> : null}

      {blocked ? (
        <View style={styles.field}>
          <Banner kind="warning">
            {blocked === 'unavailable'
              ? se.aiUnavailable(sector.sellNounPlural)
              : se.dailyLimitReached(sector.sellNounPlural)}
          </Banner>
          <Button
            label={se.addOneByOne}
            variant="secondary"
            onPress={() => router.replace(manualPath)}
          />
        </View>
      ) : null}

      <View style={styles.buttonRow}>
        <SourceButton
          icon="camera"
          label={sm.takePhoto}
          onPress={() => pickFiles({ accept: 'image/*', capture: 'environment' }).then(addPhotos)}
        />
        <SourceButton
          icon="image"
          label={sm.choosePhotos}
          onPress={() => pickFiles({ accept: 'image/*', multiple: true }).then(addPhotos)}
        />
        <SourceButton
          icon="document"
          label={sm.choosePdf}
          onPress={() => pickFiles({ accept: 'application/pdf' }).then(addPdf)}
        />
      </View>

      {images.length > 0 ? (
        <View style={styles.thumbs}>
          {images.map((image, index) => (
            <View key={image.previewUrl} style={styles.thumb}>
              <Image source={{ uri: image.previewUrl }} style={styles.thumbImage} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${sm.removeFile} ${index + 1}`}
                onPress={() => removeImage(index)}
                style={styles.thumbRemove}
              >
                <Icon name="close" size={14} colour={colours.card} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {pdf ? (
        <View style={styles.pdfRow}>
          <Icon name="document" size={type.lg} colour={colours.primary} />
          <Small style={styles.pdfName}>{pdf.name}</Small>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sm.removeFile}
            onPress={() => setPdf(null)}
            style={styles.pdfRemove}
          >
            <Icon name="close" size={16} colour={colours.muted} />
          </Pressable>
        </View>
      ) : null}

      <Small style={styles.privacyNote}>{sm.privacyNote}</Small>

      <Button
        label={sm.readButton(noun)}
        onPress={handleSubmit}
        disabled={images.length === 0 && !pdf}
        loading={submitting}
      />
    </Screen>
  );
}

function SourceButton({
  icon,
  label,
  onPress,
}: {
  icon: 'camera' | 'image' | 'document';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.sourceButton}>
      <Icon name={icon} size={28} colour={colours.primary} />
      <Small style={styles.sourceButtonLabel}>{label}</Small>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  backBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
  },
  subtitle: {
    color: colours.muted,
  },
  field: {
    gap: spacing.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sourceButton: {
    flex: 1,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  sourceButtonLabel: {
    textAlign: 'center',
    fontFamily: fonts.bodyExtraBold,
  },
  thumbs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  thumb: {
    width: 84,
    height: 84,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(34,49,46,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  pdfName: {
    flex: 1,
    fontFamily: fonts.bodyExtraBold,
  },
  pdfRemove: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyNote: {
    color: colours.muted,
  },
});
