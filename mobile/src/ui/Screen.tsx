import React, { useState } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMinWidth } from '../hooks/useMinWidth';
import { colours, spacing } from '../theme/tokens';
import { MAX_CONTENT_WIDTH, WIZARD_ASIDE_BREAKPOINT, WIZARD_ASIDE_WIDTH } from './constants';

type Props = {
  children: React.ReactNode;
  /** A `BottomActionBar`. Rendered as a sibling overlay, and its measured height is added to the
   * scroll content's bottom padding so the last bit of content is never hidden behind it. */
  bottomBar?: React.ReactNode;
  /** The content column's width above the phone-width default — Step 8d's per-screen-type widths
   * (e.g. `AUTH_CARD_WIDTH`, `WIZARD_CONTENT_WIDTH`, `HOME_CONTENT_WIDTH`). */
  maxWidth?: number;
  /** A secondary panel (a live preview, help text) shown below `children` on phones and tablets, and
   * beside it in its own column once the window reaches `asideBreakpoint` — e.g. step 2's brand
   * preview, step 5's role descriptions. */
  aside?: React.ReactNode;
  asideWidth?: number;
  asideBreakpoint?: number;
};

/**
 * The page wrapper. Full width with a 16px side margin on a phone; on a wider window, centres a
 * column at `maxWidth` (480px by default — Step 2's original wording) on the background colour.
 * Scrolls, and — via `bottomBar` — keeps content clear of a sticky `BottomActionBar`.
 */
export function Screen({
  children,
  bottomBar,
  maxWidth = MAX_CONTENT_WIDTH,
  aside,
  asideWidth = WIZARD_ASIDE_WIDTH,
  asideBreakpoint = WIZARD_ASIDE_BREAKPOINT,
}: Props) {
  const [barHeight, setBarHeight] = useState(0);
  const insets = useSafeAreaInsets();
  // Always called (never behind the `aside` check) — conditionally calling a hook breaks React's
  // rules of hooks the moment `aside` toggles between renders.
  const isWideEnoughForAside = useMinWidth(asideBreakpoint);
  const showAsideBeside = Boolean(aside) && isWideEnoughForAside;
  const outerMaxWidth = showAsideBeside ? maxWidth + asideWidth + spacing.xl : maxWidth;

  const onBarLayout = (event: LayoutChangeEvent) => {
    setBarHeight(event.nativeEvent.layout.height);
  };

  return (
    <View style={styles.outer}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { maxWidth: outerMaxWidth, paddingTop: spacing.xl + insets.top },
          // BottomActionBar already adds its own bottom inset when it's the thing sitting at the
          // edge; a screen with no bottom bar still needs the content itself clear of the home
          // indicator / gesture bar area.
          bottomBar
            ? { paddingBottom: barHeight + spacing.xl }
            : { paddingBottom: spacing.xl + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {showAsideBeside ? (
          <View style={styles.row}>
            <View style={[styles.mainColumn, { maxWidth }]}>{children}</View>
            <View style={{ width: asideWidth }}>{aside}</View>
          </View>
        ) : (
          <>
            {children}
            {aside}
          </>
        )}
      </ScrollView>
      {bottomBar ? (
        <View style={styles.barWrap}>
          <View style={[styles.barInner, { maxWidth }]} onLayout={onBarLayout}>
            {bottomBar}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    backgroundColor: colours.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.xl,
    alignItems: 'flex-start',
  },
  mainColumn: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xl,
  },
  barWrap: {
    // Pinned to the viewport edges — the thing that makes the bar sticky. Deliberately no
    // width/maxWidth here: combined with an explicit `left`/`right`, either would make the box
    // over-constrained and resolve flush against the left edge instead of centred (confirmed by
    // screenshot at desktop widths before this was split into two layers). `barInner` below is a
    // plain, non-absolute child instead, so ordinary centring rules apply without that conflict —
    // and because it's a normal in-flow child, its height still correctly reaches `onBarLayout`.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  barInner: {
    width: '100%',
    alignSelf: 'center',
  },
});
