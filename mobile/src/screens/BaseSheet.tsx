import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Base } from '../api/bases';
import { ApiError } from '../api/client';
import type { StockItem } from '../api/stock';
import { useAuth } from '../auth/AuthContext';
import {
  BaseRecipeForm,
  baseIngredientsPayload,
  baseToDraft,
  EMPTY_BASE_DRAFT,
  type BaseDraft,
} from '../forms/BaseRecipeForm';
import { validateBaseDraft } from '../forms/validateBase';
import { strings } from '../strings';
import { Banner, Button, ConfirmDialog, Sheet, Small } from '../ui';
import { colours, fonts, spacing } from '../theme/tokens';

const bs = strings.settings.bases;

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onDeleted: (message: string) => void;
  /** null = create a new base; set = edit this one. */
  editingBase: Base | null;
  existingBases: Base[];
  stockItems: StockItem[] | null;
  /** Owner-only navigation to this base's "Used in" screen — undefined hides the link. */
  onViewUsedIn?: (base: Base) => void;
};

/** Create/edit sheet for one batch recipe ("base") — Settings' "Things you make in batches"
 * (Step 42b1c1). Sends every field, not just the changed ones, same reasoning as StockItemSheet. */
export function BaseSheet({
  visible,
  onClose,
  onSaved,
  onDeleted,
  editingBase,
  existingBases,
  stockItems,
  onViewUsedIn,
}: Props) {
  const { authedFetch, businesses } = useAuth();
  const business = businesses[0];

  const [draft, setDraft] = useState<BaseDraft>(EMPTY_BASE_DRAFT);
  const [errors, setErrors] = useState<ReturnType<typeof validateBaseDraft>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDraft(editingBase ? baseToDraft(editingBase) : EMPTY_BASE_DRAFT);
    setErrors({});
    setFormError(null);
    setDeleteVisible(false);
    // Only re-seed when the sheet opens or what it's editing changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingBase?.id]);

  function mapError(err: unknown) {
    if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
      setFormError(bs.errors.network);
    } else if (err instanceof ApiError) {
      setFormError(err.message || bs.errors.generic);
    } else {
      setFormError(bs.errors.generic);
    }
  }

  async function handleSave() {
    setFormError(null);
    const nextErrors = validateBaseDraft(
      draft,
      existingBases.filter((base) => base.id !== editingBase?.id),
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !business) return;

    setSaving(true);
    try {
      const body = {
        name: draft.name.trim(),
        unit_family: draft.unitFamily,
        batch_yield_qty: draft.batchYieldQty.trim() || '1000',
        ingredients: baseIngredientsPayload(draft),
      };
      if (editingBase) {
        await authedFetch(`/businesses/${business.id}/bases/${editingBase.id}/`, {
          method: 'PATCH',
          body,
        });
        onSaved(bs.savedToast);
      } else {
        await authedFetch(`/businesses/${business.id}/bases/`, { method: 'POST', body });
        onSaved(bs.addedToast);
      }
    } catch (err) {
      mapError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!business || !editingBase) return;
    setDeleting(true);
    try {
      const inUse = editingBase.used_in.length > 0;
      await authedFetch(`/businesses/${business.id}/bases/${editingBase.id}/`, {
        method: 'DELETE',
        body: inUse ? { confirm_unlink: true } : undefined,
      });
      setDeleteVisible(false);
      onDeleted(bs.deletedToast);
    } catch (err) {
      setDeleteVisible(false);
      mapError(err);
    } finally {
      setDeleting(false);
    }
  }

  const usedInCount = editingBase?.used_in.length ?? 0;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={editingBase ? bs.editSheetTitle : bs.addSheetTitle}
    >
      {formError ? (
        <View style={styles.banner}>
          <Banner kind="error">{formError}</Banner>
        </View>
      ) : null}
      <View style={styles.formWrap}>
        <BaseRecipeForm
          value={draft}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          errors={errors}
          stockItems={stockItems}
        />
      </View>

      {editingBase && onViewUsedIn ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onViewUsedIn(editingBase)}
          style={styles.usedInLink}
        >
          <Small style={styles.usedInLinkText}>
            {bs.usedInCount(usedInCount)} · {bs.usedInLink}
          </Small>
        </Pressable>
      ) : null}

      <Button label={bs.save} variant="primary" onPress={handleSave} loading={saving} />

      {editingBase ? (
        <Button
          label={bs.deleteButton}
          variant="primary"
          colour={colours.danger}
          onPress={() => setDeleteVisible(true)}
        />
      ) : null}

      <ConfirmDialog
        visible={deleteVisible}
        title={bs.deleteConfirmTitle}
        body={usedInCount > 0 ? bs.deleteInUseMessage(usedInCount) : bs.deleteConfirmBody}
        confirmLabel={bs.deleteConfirmButton}
        cancelLabel={bs.cancel}
        onConfirm={handleDelete}
        onCancel={() => setDeleteVisible(false)}
        confirmLoading={deleting}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginBottom: spacing.md,
  },
  formWrap: {
    marginBottom: spacing.lg,
  },
  usedInLink: {
    minHeight: 44,
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  usedInLinkText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
});
