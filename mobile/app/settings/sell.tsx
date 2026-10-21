import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { SellItem, StockItem } from '../../src/api/stock';
import { ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { groupItems } from '../../src/forms/groupItems';
import { EMPTY_SELL_ITEM_DRAFT, SellItemForm } from '../../src/forms/SellItemForm';
import type { StockItemDraft } from '../../src/forms/StockItemForm';
import { validateSellItemDraft } from '../../src/forms/validateSellItem';
import { useInstantAdd } from '../../src/hooks/useInstantAdd';
import { sellItemLabel } from '../../src/labels';
import { SellItemSheet } from '../../src/screens/SellItemSheet';
import { strings } from '../../src/strings';
import { formatRupees } from '../../src/format';
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

const ss = strings.settings.sell;

export default function SellItemsSettings() {
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [items, setItems] = useState<SellItem[] | null>(null);
  const [stockItems, setStockItems] = useState<StockItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [addFieldErrors, setAddFieldErrors] = useState<ReturnType<typeof validateSellItemDraft>>(
    {},
  );
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<SellItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!business) return;
    setLoading(true);
    setFailed(false);
    authedFetch<SellItem[]>(`/businesses/${business.id}/sell-items/?include_inactive=1`)
      .then(setItems)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
    authedFetch<StockItem[]>(`/businesses/${business.id}/stock-items/`)
      .then((stock) => setStockItems(stock.filter((item) => !item.shared)))
      .catch(() => setStockItems([]));
  }, [business, authedFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const instant = useInstantAdd<SellItem, typeof EMPTY_SELL_ITEM_DRAFT>({
    items: items ?? [],
    setItems: (updater) => setItems((current) => updater(current ?? [])),
    emptyDraft: EMPTY_SELL_ITEM_DRAFT,
    toOptimistic: (draft) => ({
      id: 0,
      name: draft.name.trim(),
      selling_price: draft.sellingPrice.trim(),
      main_stock_item: draft.mainStockItemId,
      uses_qty: draft.usesQty.trim() || null,
      group: draft.group.trim(),
      active: true,
      created_at: new Date().toISOString(),
    }),
    save: async (draft) => {
      const results = await authedFetch<SellItem[]>(
        `/businesses/${business!.id}/sell-items/bulk/`,
        {
          method: 'POST',
          body: {
            items: [
              {
                name: draft.name.trim(),
                selling_price: draft.sellingPrice.trim(),
                main_stock_item: draft.mainStockItemId ?? undefined,
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

  const label = sellItemLabel(business?.business_type ?? '');
  const all = items ?? [];
  const existingGroups = [...new Set(all.map((item) => item.group).filter(Boolean))];

  async function handleAddStockItem(stockDraft: StockItemDraft): Promise<StockItem> {
    const results = await authedFetch<StockItem[]>(
      `/businesses/${business!.id}/stock-items/bulk/`,
      {
        method: 'POST',
        body: {
          items: [
            {
              name: stockDraft.name.trim(),
              unit: stockDraft.unit,
              usual_price: stockDraft.usualPrice.trim() || undefined,
              supplier: stockDraft.supplier.trim() || undefined,
              shared: stockDraft.shared,
              goes_off: stockDraft.goesOff,
              shelf_life_days:
                stockDraft.goesOff && stockDraft.shelfLifeDays.trim()
                  ? Number(stockDraft.shelfLifeDays)
                  : undefined,
              group: stockDraft.group.trim() || undefined,
            },
          ],
        },
      },
    );
    const created = results[0];
    setStockItems((current) => [created, ...(current ?? [])]);
    return created;
  }

  async function handleAdd() {
    setAddFormError(null);
    const errors = validateSellItemDraft(instant.draft, all);
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
          <SellItemForm
            value={instant.draft}
            onChange={instant.setDraft}
            errors={addFieldErrors}
            businessType={business?.business_type ?? ''}
            stockItems={stockItems}
            onAddStockItem={handleAddStockItem}
            existingGroups={existingGroups}
            nameFieldRef={instant.nameFieldRef}
          />
          <Button
            label={ss.addItem(label)}
            variant="primary"
            onPress={handleAdd}
            loading={instant.saving}
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
            buttonLabel={ss.addItem(label)}
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
                    <SellRow
                      item={item}
                      stockItems={stockItems}
                      onPress={() => setEditingItem(item)}
                    />
                  )}
                />
              </View>
            ) : null}

            {inactiveItems.length > 0 ? (
              <View style={styles.section}>
                <Small style={styles.sectionLabel}>{ss.inactiveSection}</Small>
                <View style={styles.list}>
                  {inactiveItems.map((item) => (
                    <SellRow
                      key={item.id}
                      item={item}
                      stockItems={stockItems}
                      onPress={() => setEditingItem(item)}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </Screen>

      {editingItem ? (
        <SellItemSheet
          visible={Boolean(editingItem)}
          editingItem={editingItem}
          existingItems={all}
          stockItems={stockItems}
          onStockItemAdded={(item) => setStockItems((current) => [item, ...(current ?? [])])}
          onClose={() => setEditingItem(null)}
          onSaved={(message) => {
            setEditingItem(null);
            setToast(message);
            load();
          }}
        />
      ) : null}
      <Toast message={toast} onHide={() => setToast(null)} />
    </AppShell>
  );
}

function SellRow({
  item,
  stockItems,
  onPress,
}: {
  item: SellItem;
  stockItems: StockItem[] | null;
  onPress: () => void;
}) {
  const linked = stockItems?.find((stock) => stock.id === item.main_stock_item);
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
          {formatRupees(item.selling_price)}
          {linked ? ` · ${linked.name}` : ''}
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
