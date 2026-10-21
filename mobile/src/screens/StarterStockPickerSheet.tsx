import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { StarterPack, StockItem } from '../api/stock';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { strings } from '../strings';
import { Banner, Button, Sheet } from '../ui';
import { spacing } from '../theme/tokens';
import {
  buildStarterBulkPayload,
  EMPTY_STARTER_PICKER_VALUE,
  starterPickerCount,
  StarterStockPicker,
  type StarterPickerValue,
} from './StarterStockPicker';

const ss = strings.settings.stock;

type Props = {
  visible: boolean;
  onClose: () => void;
  businessId: number;
  businessType: string;
  /** This business's current stock items — passed down so the picker hides what's already there. */
  existingItems: StockItem[];
  /** Called once the bulk create succeeds, with a toast message to show. */
  onSaved: (message: string) => void;
};

/**
 * "Add from starter list" from Settings' "What you buy" — the same StarterStockPicker setup/3 uses,
 * just reached from a sheet instead of being inline on a wizard step, with its own Continue button
 * since there's no wizard "Next" to piggyback on here.
 */
export function StarterStockPickerSheet({
  visible,
  onClose,
  businessId,
  businessType,
  existingItems,
  onSaved,
}: Props) {
  const { authedFetch } = useAuth();
  const [starterPack, setStarterPack] = useState<StarterPack | null>(null);
  const [value, setValue] = useState<StarterPickerValue>(EMPTY_STARTER_PICKER_VALUE);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setValue(EMPTY_STARTER_PICKER_VALUE);
    setFormError(null);
    authedFetch<StarterPack>(`/starter-packs/${businessType}/`)
      .then(setStarterPack)
      .catch(() => setStarterPack({ stock_items: [], sell_items: [] }));
    // Only re-fetch when the sheet opens for this business type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, businessType]);

  async function handleContinue() {
    setFormError(null);
    const payload = buildStarterBulkPayload(starterPack?.stock_items ?? [], value);
    if (payload.items.length === 0) return;

    setSaving(true);
    try {
      await authedFetch(`/businesses/${businessId}/stock-items/bulk/`, {
        method: 'POST',
        body: payload,
      });
      onSaved(ss.addedToast);
    } catch (err) {
      if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
        setFormError(ss.errors.network);
      } else if (err instanceof ApiError) {
        setFormError(err.message || ss.errors.generic);
      } else {
        setFormError(ss.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  const selectedCount = starterPickerCount(value);

  return (
    <Sheet visible={visible} onClose={onClose} title={ss.addFromStarterList}>
      {formError ? (
        <View style={styles.banner}>
          <Banner kind="error">{formError}</Banner>
        </View>
      ) : null}
      <View style={styles.pickerWrap}>
        <StarterStockPicker
          catalogue={starterPack?.stock_items ?? []}
          existingItems={existingItems}
          value={value}
          onChange={setValue}
          businessType={businessType}
        />
      </View>
      <Button
        label={selectedCount > 0 ? ss.addSelected(selectedCount) : ss.continueButton}
        variant="primary"
        onPress={handleContinue}
        loading={saving}
        disabled={selectedCount === 0}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginBottom: spacing.md,
  },
  pickerWrap: {
    marginBottom: spacing.lg,
  },
});
