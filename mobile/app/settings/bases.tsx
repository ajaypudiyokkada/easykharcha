import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { Base } from '../../src/api/bases';
import type { StockItem } from '../../src/api/stock';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { BaseSheet } from '../../src/screens/BaseSheet';
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

const bs = strings.settings.bases;

export default function BasesSettings() {
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [bases, setBases] = useState<Base[] | null>(null);
  const [stockItems, setStockItems] = useState<StockItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [editingBase, setEditingBase] = useState<Base | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!business) return;
    setLoading(true);
    setFailed(false);
    Promise.all([
      authedFetch<Base[]>(`/businesses/${business.id}/bases/`),
      authedFetch<StockItem[]>(`/businesses/${business.id}/stock-items/`),
    ])
      .then(([baseRows, stockRows]) => {
        setBases(baseRows);
        setStockItems(stockRows);
      })
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
  if (!can(permissions, 'sellitems.manage')) {
    return (
      <AppShell active="settings">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  const all = bases ?? [];
  const filtered = all.filter((base) =>
    base.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <AppShell active="settings">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{bs.title}</Heading>

        <Button label={bs.addItem} variant="primary" onPress={() => setCreating(true)} />

        <TextField
          label={bs.searchPlaceholder}
          value={search}
          onChangeText={setSearch}
          placeholder={bs.searchPlaceholder}
        />

        {failed ? (
          <ReadError onRetry={load} loading={loading} />
        ) : loading ? (
          <SkeletonList count={3} height={64} />
        ) : filtered.length === 0 ? (
          <EmptyState title={bs.empty} buttonLabel={bs.addItem} onPress={() => setCreating(true)} />
        ) : (
          <View style={styles.list}>
            {filtered.map((base) => (
              <BaseRow key={base.id} base={base} onPress={() => setEditingBase(base)} />
            ))}
          </View>
        )}
      </Screen>

      {creating ? (
        <BaseSheet
          visible={creating}
          editingBase={null}
          existingBases={all}
          stockItems={stockItems}
          onClose={() => setCreating(false)}
          onSaved={(message) => {
            setCreating(false);
            setToast(message);
            load();
          }}
        />
      ) : null}
      {editingBase ? (
        <BaseSheet
          visible={Boolean(editingBase)}
          editingBase={editingBase}
          existingBases={all}
          stockItems={stockItems}
          onClose={() => setEditingBase(null)}
          onSaved={(message) => {
            setEditingBase(null);
            setToast(message);
            load();
          }}
        />
      ) : null}
      <Toast message={toast} onHide={() => setToast(null)} />
    </AppShell>
  );
}

function BaseRow({ base, onPress }: { base: Base; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={base.name}
      onPress={onPress}
      style={styles.row}
    >
      <View style={styles.rowMain}>
        <Body style={styles.rowName}>{base.name}</Body>
        <Small style={styles.rowMeta}>
          {bs.usedInCount(base.used_in.length)} · {base.ingredients.length} ingredients
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
