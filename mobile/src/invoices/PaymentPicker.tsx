import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ApiError } from '../api/client';
import type { PaymentModeKey } from '../api/invoices';
import { useAuth } from '../auth/AuthContext';
import { pickFiles } from '../forms/filePicker';
import { resizeImageForUpload, validateImageType } from '../forms/menuFileValidation';
import { strings } from '../strings';
import { colours, fonts, radii, spacing } from '../theme/tokens';
import { Banner, Body, Button, Small } from '../ui';

const s = strings.invoice.payment;

export const PAYMENT_MODES: PaymentModeKey[] = ['cash', 'upi', 'card', 'bank_transfer'];

export type PaymentValue = {
  paid: boolean;
  mode: PaymentModeKey | '';
  /** The id of an already-uploaded proof photo (the only thing kept in a saved draft). */
  proofId: number | null;
};

export const UNPAID: PaymentValue = { paid: false, mode: '', proofId: null };

export function modeLabel(mode: string): string {
  return s.modes[mode as PaymentModeKey] ?? mode;
}

type Props = {
  value: PaymentValue;
  onChange: (next: PaymentValue) => void;
  /** The create form offers Unpaid/Paid; the "Mark as paid" sheet only ever pays. */
  allowUnpaid: boolean;
  modeError?: string;
  proofError?: string;
};

/** Payment status chips (optional), mode chips, and, for any non-cash mode, the proof photo: take or
 * choose a photo, upload it right away, show a thumbnail with Replace / Remove. Shared by the Create
 * invoice form and the "Mark as paid" sheet so the two can't drift apart. Switching to Cash or Unpaid
 * clears the chosen proof. */
export function PaymentPicker({ value, onChange, allowUnpaid, modeError, proofError }: Props) {
  const { authedFetch, businesses } = useAuth();
  const businessId = businesses[0]?.id;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const uploadingRef = useRef(false);

  const needsProof = value.paid && value.mode !== '' && value.mode !== 'cash';

  // Drop the local thumbnail as soon as the proof is gone (removed, or cleared by a mode change).
  useEffect(() => {
    if (value.proofId === null && previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setDuplicate(false);
    }
  }, [value.proofId, previewUrl]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    // Only on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function choosePaid(paid: boolean) {
    setUploadError(null);
    onChange(paid ? { ...value, paid: true } : UNPAID);
  }

  function chooseMode(mode: PaymentModeKey) {
    setUploadError(null);
    // Cash needs no proof, so a photo chosen under another mode is dropped.
    onChange({ paid: true, mode, proofId: mode === 'cash' ? null : value.proofId });
  }

  async function pick(camera: boolean) {
    if (uploadingRef.current || !businessId) return;
    const files = await pickFiles({
      accept: 'image/jpeg,image/png,image/webp',
      capture: camera ? 'environment' : undefined,
    });
    const file = files[0];
    if (!file) return;
    setUploadError(null);
    if (validateImageType(file)) {
      setUploadError(s.wrongType);
      return;
    }
    uploadingRef.current = true;
    setUploading(true);
    try {
      const resized = await resizeImageForUpload(file);
      const form = new FormData();
      form.append('image', resized, resized.name);
      const response = await authedFetch<{ proof_id: number; proof_already_used: boolean }>(
        `/businesses/${businessId}/payment-proofs/`,
        { method: 'POST', body: form },
      );
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(resized);
      });
      setDuplicate(response.proof_already_used);
      onChange({ ...value, paid: true, proofId: response.proof_id });
    } catch (err) {
      // The server's own message for a wrong type or a too-big photo; anything else is generic.
      if (
        err instanceof ApiError &&
        err.status === 400 &&
        (err.code === 'INVALID_IMAGE' || err.code === 'IMAGE_TOO_LARGE')
      ) {
        setUploadError(err.message);
      } else {
        setUploadError(s.uploadFailed);
      }
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }

  function removeProof() {
    setUploadError(null);
    onChange({ ...value, proofId: null });
  }

  const shownError = uploadError ?? proofError;

  return (
    <View style={styles.stack}>
      {allowUnpaid ? (
        <View style={styles.chips}>
          <Chip label={s.unpaid} active={!value.paid} onPress={() => choosePaid(false)} />
          <Chip label={s.paid} active={value.paid} onPress={() => choosePaid(true)} />
        </View>
      ) : null}

      {value.paid ? (
        <View style={styles.stack}>
          <Small style={styles.label}>{s.modeLabel}</Small>
          <View style={styles.chips}>
            {PAYMENT_MODES.map((mode) => (
              <Chip
                key={mode}
                label={s.modes[mode]}
                active={value.mode === mode}
                onPress={() => chooseMode(mode)}
              />
            ))}
          </View>
          {modeError ? <Small style={styles.error}>{modeError}</Small> : null}
        </View>
      ) : null}

      {needsProof ? (
        <View style={styles.stack}>
          <Small style={styles.label}>{s.proofLabel}</Small>
          {value.proofId === null ? (
            <View style={styles.buttons}>
              <View style={styles.flex}>
                <Button
                  label={s.takePhoto}
                  variant="secondary"
                  onPress={() => pick(true)}
                  disabled={uploading}
                />
              </View>
              <View style={styles.flex}>
                <Button
                  label={s.choosePhoto}
                  variant="secondary"
                  onPress={() => pick(false)}
                  disabled={uploading}
                />
              </View>
            </View>
          ) : (
            <View style={styles.proofRow}>
              {previewUrl
                ? React.createElement('img', {
                    src: previewUrl,
                    alt: s.thumbAlt,
                    style: {
                      width: 96,
                      height: 96,
                      objectFit: 'cover',
                      borderRadius: radii.md,
                      border: `2px solid ${colours.mint}`,
                    },
                  })
                : null}
              <View style={styles.flex}>
                <Body style={styles.label}>{s.attached}</Body>
                <View style={styles.buttons}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => pick(false)}
                    disabled={uploading}
                    style={styles.link}
                  >
                    <Small style={styles.linkText}>{s.replace}</Small>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={removeProof}
                    disabled={uploading}
                    style={styles.link}
                  >
                    <Small style={styles.removeText}>{s.remove}</Small>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
          {uploading ? <Small style={styles.muted}>{s.uploading}</Small> : null}
          {shownError ? <Small style={styles.error}>{shownError}</Small> : null}
          {duplicate ? <Banner kind="warning">{s.duplicate}</Banner> : null}
        </View>
      ) : null}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : null]}
    >
      <Small style={active ? styles.chipTextActive : styles.chipText}>{label}</Small>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
  },
  chipActive: { backgroundColor: colours.primary },
  chipText: { color: colours.text, fontFamily: fonts.bodyExtraBold },
  chipTextActive: { color: colours.card, fontFamily: fonts.bodyExtraBold },
  label: { fontFamily: fonts.bodyExtraBold, color: colours.text },
  muted: { color: colours.muted },
  error: { color: colours.danger, fontFamily: fonts.bodyExtraBold },
  buttons: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  proofRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  link: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  linkText: { color: colours.primary, fontFamily: fonts.bodyExtraBold },
  removeText: { color: colours.danger, fontFamily: fonts.bodyExtraBold },
});
