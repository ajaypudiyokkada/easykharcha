import { Redirect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { SellItem, StockItem } from '../../src/api/stock';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { groupItems } from '../../src/forms/groupItems';
import { sellItemLabel } from '../../src/labels';
import { SellItemSheet } from '../../src/screens/SellItemSheet';
import { strings } from '../../src/strings';
import { formatRupees } from '../../src/format';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import {
  AppShell,
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
const sd = strings.dishForm;

export default function SellItemsSettings() {
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];
  const params = useLocalSearchParams<{ filter?: string; edit?: string }>();

  const [items, setItems] = useState<SellItem[] | null>(null);
  const [stockItems, setStockItems] = useState<StockItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [needsIngredientsOnly, setNeedsIngredientsOnly] = useState(
    params.filter === 'needs_ingredients',
  );
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<SellItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [openedEditFromParam, setOpenedEditFromParam] = useState(false);

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

  // A count-review gap reason or the Home "needs ingredients" nudge can deep-link straight to one
  // dish's edit sheet, or pre-filter the list — only once items have actually loaded.
  useEffect(() => {
    if (openedEditFromParam || !params.edit || !items) return;
    const target = items.find((item) => item.id === Number(params.edit));
    if (target) {
      setEditingItem(target);
      setSheetVisible(true);
    }
    setOpenedEditFromParam(true);
  }, [params.edit, items, openedEditFromParam]);

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

  const matchingSearch = all.filter((item) =>
    item.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const filtered = needsIngredientsOnly
    ? matchingSearch.filter((item) => item.recipe_status !== 'confirmed')
    : matchingSearch;
  const activeItems = groupItems(filtered.filter((item) => item.active));
  const inactiveItems = filtered.filter((item) => !item.active);

  return (
    <AppShell active="settings">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{ss.title}</Heading>

        <Button
          label={sd.addDish(label)}
          variant="primary"
          onPress={() => {
            setEditingItem(null);
            setSheetVisible(true);
          }}
        />

        <TextField
          label={ss.searchPlaceholder}
          value={search}
          onChangeText={setSearch}
          placeholder={ss.searchPlaceholder}
        />

        {needsIngredientsOnly ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setNeedsIngredientsOnly(false)}
            style={styles.filterChip}
          >
            <Small style={styles.filterChipText}>{ss.needsIngredientsFilter}</Small>
            <Small style={styles.filterChipClear}>{ss.clearFilter}</Small>
          </Pressable>
        ) : null}

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading ? (
          <SkeletonList count={3} height={64} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={ss.empty}
            buttonLabel={sd.addDish(label)}
            onPress={() => {
              setEditingItem(null);
              setSheetVisible(true);
            }}
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
                      onPress={() => {
                        setEditingItem(item);
                        setSheetVisible(true);
                      }}
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
                      onPress={() => {
                        setEditingItem(item);
                        setSheetVisible(true);
                      }}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </Screen>

      <SellItemSheet
        visible={sheetVisible}
        business={business}
        editingItem={editingItem}
        existingItems={all}
        stockItems={stockItems}
        onStockItemAdded={(item) => setStockItems((current) => [item, ...(current ?? [])])}
        onClose={() => setSheetVisible(false)}
        onSaved={(message) => {
          setSheetVisible(false);
          setToast(message);
          load();
        }}
      />
      <Toast message={toast} onHide={() => setToast(null)} />
    </AppShell>
  );
}

function SellRow({ item, onPress }: { item: SellItem; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.name}
      onPress={onPress}
      style={[styles.row, !item.active ? styles.rowInactive : null]}
    >
      <View style={styles.rowMain}>
        <View style={styles.rowTitleLine}>
          <Body style={styles.rowName}>{item.name}</Body>
          {item.recipe_status === 'none' ? <Badge label={ss.needsIngredientsBadge} /> : null}
          {item.recipe_status === 'unconfirmed' ? (
            <Badge label={ss.estimateConfirmBadge} warning />
          ) : null}
        </View>
        <Small style={styles.rowMeta}>
          {formatRupees(item.selling_price)}
          {item.portion_label ? ` · ${item.portion_label}` : ''}
        </Small>
      </View>
    </Pressable>
  );
}

/** A plain pill badge — "Needs ingredients" (muted, routine) vs "Estimate - confirm" (warning,
 * needs review) — same small local pattern as counts/[id].tsx's own Badge, not promoted to a shared
 * component for just two call sites. */
function Badge({ label, warning }: { label: string; warning?: boolean }) {
  return (
    <View style={[styles.badge, warning ? styles.badgeWarning : null]}>
      <Small style={styles.badgeText}>{label}</Small>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
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
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: colours.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  filterChipText: {
    fontFamily: fonts.bodyExtraBold,
  },
  filterChipClear: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
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
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowName: {
    fontFamily: fonts.bodyExtraBold,
  },
  rowMeta: {
    color: colours.muted,
  },
  badge: {
    minHeight: 24,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colours.muted,
  },
  badgeWarning: {
    backgroundColor: colours.warning,
  },
  badgeText: {
    color: colours.card,
    fontFamily: fonts.bodyExtraBold,
  },
});
