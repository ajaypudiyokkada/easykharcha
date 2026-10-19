import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { GroupBucket } from '../forms/groupItems';
import { colours, fonts, radii, spacing } from '../theme/tokens';
import { MIN_TOUCH_TARGET } from './constants';
import { Icon } from './Icon';
import { Small } from './Text';

type Props<T> = {
  groups: GroupBucket<T>[];
  getKey: (item: T) => string | number;
  renderItem: (item: T) => React.ReactNode;
  /** Collapsed by default once there are more than this many groups, so a business with a dozen
   * groups doesn't open onto one long scroll of everything expanded. */
  collapseAboveGroups?: number;
};

/** Collapsible group headings (Ungrouped last — groupItems() already orders it that way), shared
 * by Settings' stock/sell lists, the onboarding wizard's "added items" list, and the sell-item
 * form's "what it uses" picker — Step 19's one grouped-list component, used everywhere a grouped
 * item list shows up (count/purchase/wastage item pickers still use their own plain lists; see
 * docs/STATUS.md for why that's deliberately out of this pass). */
export function GroupedList<T>({ groups, getKey, renderItem, collapseAboveGroups = 4 }: Props<T>) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    groups.length > collapseAboveGroups
      ? Object.fromEntries(groups.map(({ group }) => [group, true]))
      : {},
  );

  return (
    <View style={styles.wrap}>
      {groups.map(({ group, items }) => {
        const isCollapsed = Boolean(collapsed[group]);
        return (
          <View key={group} style={styles.section}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${group} (${items.length})`}
              onPress={() => setCollapsed((current) => ({ ...current, [group]: !isCollapsed }))}
              style={styles.header}
            >
              <Small style={styles.headerText}>
                {group} ({items.length})
              </Small>
              <Icon
                name={isCollapsed ? 'chevronRight' : 'chevronDown'}
                size={18}
                colour={colours.muted}
              />
            </Pressable>
            {!isCollapsed ? (
              <View style={styles.list}>
                {items.map((item) => (
                  <View key={getKey(item)}>{renderItem(item)}</View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  section: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
  },
  headerText: {
    color: colours.muted,
    fontFamily: fonts.bodyExtraBold,
  },
  list: {
    gap: spacing.sm,
  },
});
