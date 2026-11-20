import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { SellItem } from '../../api/stock';
import { strings } from '../../strings';
import { colours, fonts, radii, spacing } from '../../theme/tokens';
import { Body, Checkbox, Sheet, Small, TextField } from '../../ui';
import { formatPaise, parseScaled } from '../money';

const s = strings.importInvoice.pick;
const r = strings.importInvoice.review;

type Props = {
  visible: boolean;
  onClose: () => void;
  lineName: string;
  items: SellItem[] | null;
  /** False when no quantity or amount was read: the line can then only be Not an item or skipped. */
  canBeItem: boolean;
  onPickItem: (item: SellItem, remember: boolean) => void;
  onNotItem: (remember: boolean) => void;
  onSkip: () => void;
};

/** "Pick the item": the owner's items you sell, with two special choices on top, and "Remember this
 * match next time" (on by default). */
export function PickItemSheet({
  visible,
  onClose,
  lineName,
  items,
  canBeItem,
  onPickItem,
  onNotItem,
  onSkip,
}: Props) {
  const [query, setQuery] = useState('');
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setRemember(true);
    }
  }, [visible]);

  const shown = (items ?? []).filter((i) =>
    i.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <Sheet visible={visible} onClose={onClose} title={s.title}>
      <View style={styles.stack}>
        <Body style={styles.muted}>{s.lead}</Body>
        <Body style={styles.name}>{lineName}</Body>

        <Choice title={s.notItem} hint={s.notItemHint} onPress={() => onNotItem(remember)} />
        <Choice title={s.skip} hint={s.skipHint} onPress={onSkip} />

        {canBeItem ? (
          <>
            <TextField label={s.search} value={query} onChangeText={setQuery} />
            {items !== null && items.length === 0 ? (
              <Small style={styles.muted}>{s.noItems}</Small>
            ) : null}
            {items !== null && items.length > 0 && shown.length === 0 ? (
              <Small style={styles.muted}>{s.noMatch}</Small>
            ) : null}
            {shown.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.name}
                onPress={() => onPickItem(item, remember)}
                style={styles.row}
              >
                <View style={styles.flex}>
                  <Body style={styles.name}>{item.name}</Body>
                  <Small style={styles.muted}>
                    {formatPaise(parseScaled(item.selling_price, 2) ?? 0)}
                  </Small>
                </View>
                <Small style={styles.pick}>{s.pick}</Small>
              </Pressable>
            ))}
          </>
        ) : (
          <Small style={styles.muted}>{r.cannotBeItem}</Small>
        )}

        <Checkbox title={s.remember} checked={remember} onChange={setRemember} />
      </View>
    </Sheet>
  );
}

function Choice({ title, hint, onPress }: { title: string; hint: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <View style={styles.flex}>
        <Body style={styles.name}>{title}</Body>
        <Small style={styles.muted}>{hint}</Small>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  muted: { color: colours.muted },
  name: { fontFamily: fonts.bodyExtraBold },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.md,
    backgroundColor: colours.card,
  },
  pick: { color: colours.primary, fontFamily: fonts.bodyExtraBold },
});
