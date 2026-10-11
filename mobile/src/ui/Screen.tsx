import React, { useState } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { colours, spacing } from '../theme/tokens';
import { MAX_CONTENT_WIDTH } from './constants';

type Props = {
  children: React.ReactNode;
  /** A `BottomActionBar`. Rendered as a sibling overlay, and its measured height is added to the
   * scroll content's bottom padding so the last bit of content is never hidden behind it. */
  bottomBar?: React.ReactNode;
};

/**
 * The page wrapper. Full width with a 16px side margin on a phone; on a wider window, centres a
 * column of at most 480px on the background colour (Step 2's own wording — `MAX_CONTENT_WIDTH`).
 * Scrolls, and — via `bottomBar` — keeps content clear of a sticky `BottomActionBar`.
 */
export function Screen({ children, bottomBar }: Props) {
  const [barHeight, setBarHeight] = useState(0);

  const onBarLayout = (event: LayoutChangeEvent) => {
    setBarHeight(event.nativeEvent.layout.height);
  };

  return (
    <View style={styles.outer}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          bottomBar ? { paddingBottom: barHeight + spacing.xl } : null,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {bottomBar ? (
        <View style={styles.barWrap} onLayout={onBarLayout}>
          {bottomBar}
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
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.xl,
  },
  barWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
});
