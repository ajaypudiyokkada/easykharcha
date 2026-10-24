import { Redirect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { StockItem } from '../../src/api/stock';
import { ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { groupItems } from '../../src/forms/groupItems';
import { emptyStockItemDraft, StockItemForm } from '../../src/forms/StockItemForm';
import { validateStockItemDraft } from '../../src/forms/validateStockItem';
import { useInstantAdd } from '../../src/hooks/useInstantAdd';
import { StarterStockPickerSheet } from '../../src/screens/StarterStockPickerSheet';
import { StockItemSheet } from '../../src/screens/StockItemSheet';
import { strings } from '../../src/strings';
import { unitFamily } from '../../src/units';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import {
  AppShell,
  Banner,
  Body,
  Button,
  EmptyState,
  GroupedList,
  Heading,
  NoAccess,
  ReadError,
  Screen,
  SkeletonList,
  Small,
  TextField,
  Toast,
} from '../../src/ui';
import { HOME_CONTENT_WIDTH } from '../../src/ui/constants';

const ss = strings.settings.stock;

export default function StockItemsSettings() {
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];
  // Set by Settings' "Business profile" after "Remove them and start fresh" — jumps straight into
  // the new type's starter list instead of landing on an empty "What you buy" screen.
  const params = useLocalSearchParams<{ openStarter?: string }>();

  const [items, setItems] = useState<StockItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [addFieldErrors, setAddFieldErrors] = useState<ReturnType<typeof validateStockItemDraft>>(
    {},
  );
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<StockItem | null>(null);
  const [starterListOpen, setStarterListOpen] = useState(params.openStarter === '1');
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!business) return;
    setLoading(true);
    setFailed(false);
    authedFetch<StockItem[]>(`/businesses/${business.id}/stock-items/?include_inactive=1`)
      .then(setItems)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [business, authedFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const instant = useInstantAdd<StockItem, ReturnType<typeof emptyStockItemDraft>>({
    items: items ?? [],
    setItems: (updater) => setItems((current) => updater(current ?? [])),
    emptyDraft: emptyStockItemDraft(business?.business_type ?? ''),
    toOptimistic: (draft) => ({
      id: 0,
      name: draft.name.trim(),
      unit: draft.unit || 'piece',
      unit_family: unitFamily(draft.unit || 'piece'),
      pack_size_base_qty: draft.packSizeBaseQty.trim() || null,
      unit_locked: false,
      usual_price: draft.usualPrice.trim() || null,
      usual_price_per_major_unit: draft.usualPrice.trim() || null,
      supplier: draft.supplier.trim(),
      shared: draft.shared,
      goes_off: draft.goesOff,
      shelf_life_days:
        draft.goesOff && draft.shelfLifeDays.trim() ? Number(draft.shelfLifeDays) : null,
      group: draft.group.trim(),
      active: true,
      created_at: new Date().toISOString(),
      last_unit_price: null,
      last_unit_price_per_major_unit: null,
      last_purchased_at: null,
      last_counted_qty: null,
      last_counted_at: null,
    }),
    save: async (draft) => {
      const results = await authedFetch<StockItem[]>(
        `/businesses/${business!.id}/stock-items/bulk/`,
        {
          method: 'POST',
          body: {
            items: [
              {
                name: draft.name.trim(),
                unit: draft.unit,
                pack_size_base_qty: draft.packSizeBaseQty.trim() || undefined,
                usual_price: draft.usualPrice.trim() || undefined,
                supplier: draft.supplier.trim() || undefined,
                shared: draft.shared,
                goes_off: draft.goesOff,
                shelf_life_days:
                  draft.goesOff && draft.shelfLifeDays.trim()
                    ? Number(draft.shelfLifeDays)
                    : undefined,
                group: draft.group.trim() || undefined,
              },
            ],
          },
        },
      );
      return results[0];
    },
  });

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
  if (!can(permissions, 'settings.manage')) {
    return (
      <AppShell active="settings">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  const all = items ?? [];
  const existingGroups = [...new Set(all.map((item) => item.group).filter(Boolean))];

  async function handleAdd() {
    setAddFormError(null);
    const errors = validateStockItemDraft(instant.draft, all);
    setAddFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    try {
      await instant.add();
      setAddFieldErrors({});
      setToast(ss.addedToast);
    } catch (err) {
      if (err instanceof ApiError && err.rowErrors && err.rowErrors[0]) {
        setAddFormError(err.rowErrors[0].message);
      } else if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
        setAddFormError(ss.errors.network);
      } else if (err instanceof ApiError) {
        setAddFormError(err.message || ss.errors.generic);
      } else {
        setAddFormError(ss.errors.generic);
      }
    }
  }

  const filtered = all.filter((item) =>
    item.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const activeItems = groupItems(filtered.filter((item) => item.active));
  const inactiveItems = filtered.filter((item) => !item.active);

  return (
    <AppShell active="settings">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{ss.title}</Heading>

        <View style={styles.addSection}>
          {addFormError ? <Banner kind="error">{addFormError}</Banner> : null}
          <StockItemForm
            value={instant.draft}
            onChange={instant.setDraft}
            errors={addFieldErrors}
            businessType={business?.business_type ?? ''}
            existingGroups={existingGroups}
            nameFieldRef={instant.nameFieldRef}
          />
          <Button
            label={ss.addItem}
            variant="primary"
            onPress={handleAdd}
            loading={instant.saving}
          />
          <Button
            label={ss.addFromStarterList}
            variant="secondary"
            onPress={() => setStarterListOpen(true)}
          />
        </View>

        <TextField
          label={ss.searchPlaceholder}
          value={search}
          onChangeText={setSearch}
          placeholder={ss.searchPlaceholder}
        />

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading ? (
          <SkeletonList count={3} height={64} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={ss.empty}
            buttonLabel={ss.addItem}
            onPress={() => instant.nameFieldRef.current?.focus()}
          />
        ) : (
          <>
            {activeItems.length > 0 ? (
              <View style={styles.section}>
                <Small style={styles.sectionLabel}>{ss.activeSection}</Small>
                <GroupedList
                  groups={activeItems}
                  getKey={(item) => item.id}
                  renderItem={(item) => (
                    <StockRow item={item} onPress={() => setEditingItem(item)} />
                  )}
                />
              </View>
            ) : null}

            {inactiveItems.length > 0 ? (
              <View style={styles.section}>
                <Small style={styles.sectionLabel}>{ss.inactiveSection}</Small>
                <View style={styles.list}>
                  {inactiveItems.map((item) => (
                    <StockRow key={item.id} item={item} onPress={() => setEditingItem(item)} />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </Screen>

      {editingItem ? (
        <StockItemSheet
          visible={Boolean(editingItem)}
          editingItem={editingItem}
          existingItems={all}
          onClose={() => setEditingItem(null)}
          onSaved={(message) => {
            setEditingItem(null);
            setToast(message);
            load();
          }}
        />
      ) : null}
      {business ? (
        <StarterStockPickerSheet
          visible={starterListOpen}
          onClose={() => setStarterListOpen(false)}
          businessId={business.id}
          businessType={business.business_type}
          existingItems={all}
          onSaved={(message) => {
            setStarterListOpen(false);
            setToast(message);
            load();
          }}
        />
      ) : null}
      <Toast message={toast} onHide={() => setToast(null)} />
    </AppShell>
  );
}

function StockRow({ item, onPress }: { item: StockItem; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.name}
      onPress={onPress}
      style={[styles.row, !item.active ? styles.rowInactive : null]}
    >
      <View style={styles.rowMain}>
        <Body style={styles.rowName}>{item.name}</Body>
        <Small style={styles.rowMeta}>
          {item.unit}
          {item.shared ? ' · shared' : ''}
          {item.goes_off ? ' · perishable' : ''}
        </Small>
      </View>
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
  addSection: {
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colours.muted,
    fontFamily: fonts.bodyExtraBold,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    minHeight: 60,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowInactive: {
    opacity: 0.6,
  },
  rowMain: {
    gap: 2,
  },
  rowName: {
    fontFamily: fonts.bodyExtraBold,
  },
  rowMeta: {
    color: colours.muted,
  },
});
