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
  /** Overrides the default `(items.length)` header count — e.g. a picker showing "3 of 9" ticked. */
  countLabel?: (group: string, items: T[]) => string;
  /** Extra control in the header row, before the collapse chevron — e.g. a "Select all" button.
   * Rendered as its own Pressable, so tapping it doesn't also toggle the section collapsed. */
  headerAccessory?: (group: string, items: T[]) => React.ReactNode;
};

/** Collapsible group headings (Ungrouped last — groupItems() already orders it that way), shared
 * by Settings' stock/sell lists, the onboarding wizard's "added items" list, and the sell-item
 * form's "what it uses" picker — Step 19's one grouped-list component, used everywhere a grouped
 * item list shows up (count/purchase/wastage item pickers still use their own plain lists; see
 * docs/STATUS.md for why that's deliberately out of this pass). */
export function GroupedList<T>({
  groups,
  getKey,
  renderItem,
  collapseAboveGroups = 4,
  countLabel,
  headerAccessory,
}: Props<T>) {
  // Per-group *overrides* only — collapsed-by-default is recomputed from the current `groups`
  // every render instead of being decided once at mount, so a group that only appears once a
  // search narrows the list down (e.g. to one match) opens on its own instead of staying collapsed
  // from before the search even started. A group the owner has explicitly tapped keeps whatever
  // they chose, regardless of how the list around it changes afterwards.
  const [collapsedOverride, setCollapsedOverride] = useState<Record<string, boolean>>({});
  const defaultCollapsed = groups.length > collapseAboveGroups;

  return (
    <View style={styles.wrap}>
      {groups.map(({ group, items }) => {
        const isCollapsed = collapsedOverride[group] ?? defaultCollapsed;
        const count = countLabel ? countLabel(group, items) : String(items.length);
        return (
          <View key={group} style={styles.section}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${group} (${count})`}
              onPress={() =>
                setCollapsedOverride((current) => ({ ...current, [group]: !isCollapsed }))
              }
              style={styles.header}
            >
              <Small style={styles.headerText}>
                {group} ({count})
              </Small>
              <View style={styles.headerRight}>
                {headerAccessory ? headerAccessory(group, items) : null}
                <Icon
                  name={isCollapsed ? 'chevronRight' : 'chevronDown'}
                  size={18}
                  colour={colours.muted}
                />
              </View>
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  list: {
    gap: spacing.sm,
  },
});
