import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { StockItem } from '../../src/api/stock';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { StockItemSheet } from '../../src/screens/StockItemSheet';
import { strings } from '../../src/strings';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';
import {
  AppShell,
  Body,
  Button,
  EmptyState,
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

  const [items, setItems] = useState<StockItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<StockItem | null>(null);
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

  const filtered = (items ?? []).filter((item) =>
    item.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const activeItems = filtered.filter((item) => item.active);
  const inactiveItems = filtered.filter((item) => !item.active);

  function openAdd() {
    setEditingItem(null);
    setSheetVisible(true);
  }

  function openEdit(item: StockItem) {
    setEditingItem(item);
    setSheetVisible(true);
  }

  return (
    <AppShell active="settings">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{ss.title}</Heading>

        <Button label={ss.addItem} variant="primary" onPress={openAdd} />

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
          <EmptyState title={ss.empty} buttonLabel={ss.addItem} onPress={openAdd} />
        ) : (
          <>
            {activeItems.length > 0 ? (
              <View style={styles.section}>
                <Small style={styles.sectionLabel}>{ss.activeSection}</Small>
                <View style={styles.list}>
                  {activeItems.map((item) => (
                    <StockRow key={item.id} item={item} onPress={() => openEdit(item)} />
                  ))}
                </View>
              </View>
            ) : null}

            {inactiveItems.length > 0 ? (
              <View style={styles.section}>
                <Small style={styles.sectionLabel}>{ss.inactiveSection}</Small>
                <View style={styles.list}>
                  {inactiveItems.map((item) => (
                    <StockRow key={item.id} item={item} onPress={() => openEdit(item)} />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </Screen>

      <StockItemSheet
        visible={sheetVisible}
        editingItem={editingItem}
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
          {item.goes_off ? ' · goes off' : ''}
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
