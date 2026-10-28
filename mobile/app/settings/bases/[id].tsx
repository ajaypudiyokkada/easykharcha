import { Redirect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { Base } from '../../../src/api/bases';
import { ApiError } from '../../../src/api/client';
import type { SellItem } from '../../../src/api/stock';
import { useAuth } from '../../../src/auth/AuthContext';
import { can } from '../../../src/auth/permissions';
import { strings } from '../../../src/strings';
import { colours, fonts, radii, spacing } from '../../../src/theme/tokens';
import {
  AppShell,
  Banner,
  Body,
  Button,
  Heading,
  Icon,
  NoAccess,
  ReadError,
  Screen,
  SkeletonList,
  Small,
  TextField,
  Toast,
} from '../../../src/ui';
import { HOME_CONTENT_WIDTH, MIN_TOUCH_TARGET } from '../../../src/ui/constants';

const bs = strings.settings.bases;
const ui = bs.usedIn;

let nextRowKey = 0;
function newRowKey(): string {
  nextRowKey += 1;
  return `used-in-${nextRowKey}`;
}

type UsedInRow = {
  key: string;
  sellItemId: number;
  amount: string;
};

export default function BaseUsedInScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [base, setBase] = useState<Base | null>(null);
  const [sellItems, setSellItems] = useState<SellItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [rows, setRows] = useState<UsedInRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!business || !id) return;
    setLoading(true);
    setFailed(false);
    Promise.all([
      authedFetch<Base>(`/businesses/${business.id}/bases/${id}/`),
      authedFetch<SellItem[]>(`/businesses/${business.id}/sell-items/`),
    ])
      .then(([baseRow, sellItemRows]) => {
        setBase(baseRow);
        setSellItems(sellItemRows);
        setRows(
          baseRow.used_in.map((link) => ({
            key: newRowKey(),
            sellItemId: link.sell_item,
            amount: link.quantity,
          })),
        );
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [business, id, authedFetch]);

  useEffect(() => {
    load();
  }, [load]);

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
  if (!can(permissions, 'sellitems.manage')) {
    return (
      <AppShell active="settings">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  const sellItemsById = new Map((sellItems ?? []).map((item) => [item.id, item]));
  const pickedIds = new Set(rows.map((row) => row.sellItemId));
  const pickable = (sellItems ?? []).filter((item) => item.active && !pickedIds.has(item.id));
  const searchKey = search.trim().toLowerCase();
  const filteredPickable = searchKey
    ? pickable.filter((item) => item.name.toLowerCase().includes(searchKey))
    : pickable;

  function addRow(sellItem: SellItem) {
    setRows((current) => [...current, { key: newRowKey(), sellItemId: sellItem.id, amount: '' }]);
    setPickerOpen(false);
    setSearch('');
  }

  function updateRow(key: string, amount: string) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, amount } : row)));
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  async function handleSave() {
    if (!business || !base) return;
    setFormError(null);
    for (const row of rows) {
      const value = row.amount.trim().replace(',', '.');
      if (!value || Number.isNaN(Number(value)) || Number(value) <= 0) {
        setFormError(bs.errors.invalidNumber);
        return;
      }
    }
    setSaving(true);
    try {
      const updated = await authedFetch<Base>(
        `/businesses/${business.id}/bases/${base.id}/used-in/`,
        {
          method: 'PUT',
          body: {
            links: rows.map((row) => ({
              sell_item: row.sellItemId,
              quantity: row.amount.trim().replace(',', '.'),
            })),
          },
        },
      );
      setBase(updated);
      setRows(
        updated.used_in.map((link) => ({
          key: newRowKey(),
          sellItemId: link.sell_item,
          amount: link.quantity,
        })),
      );
      setToast(ui.savedToast);
    } catch (err) {
      if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
        setFormError(bs.errors.network);
      } else if (err instanceof ApiError) {
        setFormError(err.message || bs.errors.generic);
      } else {
        setFormError(bs.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell active="settings">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{ui.title}</Heading>
        {base ? <Small style={styles.subtitle}>{ui.subtitle(base.name)}</Small> : null}

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading || !base ? (
          <SkeletonList count={3} height={64} />
        ) : (
          <>
            {formError ? <Banner kind="error">{formError}</Banner> : null}

            {rows.length === 0 ? (
              <Small style={styles.introText}>{ui.empty}</Small>
            ) : (
              <View style={styles.list}>
                {rows.map((row) => {
                  const sellItem = sellItemsById.get(row.sellItemId);
                  return (
                    <View key={row.key} style={styles.row}>
                      <View style={styles.rowHead}>
                        <Body style={styles.rowName}>{sellItem?.name ?? '—'}</Body>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${ui.removeDish} ${sellItem?.name ?? ''}`}
                          onPress={() => removeRow(row.key)}
                          style={styles.removeButton}
                        >
                          <Icon name="delete" size={18} colour={colours.danger} />
                        </Pressable>
                      </View>
                      <TextField
                        label={`${ui.amountLabel} (${base.unit})`}
                        value={row.amount}
                        onChangeText={(amount) => updateRow(row.key, amount)}
                        placeholder={bs.amountPlaceholder}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  );
                })}
              </View>
            )}

            {pickerOpen ? (
              <View style={styles.pickerPanel}>
                <Body style={styles.pickerTitle}>{ui.pickDishTitle}</Body>
                {pickable.length > 6 ? (
                  <TextField
                    label={ui.searchDishes}
                    value={search}
                    onChangeText={setSearch}
                    placeholder={ui.searchDishes}
                    left={<Icon name="search" size={16} colour={colours.muted} />}
                  />
                ) : null}
                {filteredPickable.length === 0 ? (
                  <Small style={styles.introText}>{ui.noDishesToAdd}</Small>
                ) : (
                  <View style={styles.pickerList}>
                    {filteredPickable.map((item) => (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        onPress={() => addRow(item)}
                        style={styles.pickerChip}
                      >
                        <Small style={styles.pickerChipText}>{item.name}</Small>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setPickerOpen(true)}
                style={styles.addButton}
              >
                <Small style={styles.addButtonText}>{ui.addDish}</Small>
              </Pressable>
            )}

            <Button label={ui.save} variant="primary" onPress={handleSave} loading={saving} />
          </>
        )}
      </Screen>
      <Toast message={toast} onHide={() => setToast(null)} />
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
  introText: {
    color: colours.muted,
  },
  list: {
    gap: spacing.sm,
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
  pickerPanel: {
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  pickerTitle: {
    fontFamily: fonts.bodyExtraBold,
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
  addButton: {
    alignSelf: 'flex-start',
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  addButtonText: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
  },
});
