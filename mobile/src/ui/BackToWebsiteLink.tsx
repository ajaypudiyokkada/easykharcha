import React from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { links } from '../config';
import { strings } from '../strings';
import { colours, fonts } from '../theme/tokens';
import { MIN_TOUCH_TARGET } from './constants';
import { Small } from './Text';

/**
 * A quiet way back to the marketing site — web only (there's no landing page on native). A same-tab
 * full navigation, not a route inside this app, matching how "/" itself sends a signed-out visitor
 * there (see app/index.tsx).
 */
export function BackToWebsiteLink() {
  if (Platform.OS !== 'web') return null;

  return (
    <Pressable
      accessibilityRole="link"
      style={styles.tap}
      onPress={() => {
        window.location.href = links.landingUrl;
      }}
    >
      <Small style={styles.link}>{strings.app.backToWebsite}</Small>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A bare text Pressable has no touch target beyond its glyph box — padded to the 44px floor
  // without changing how the link itself looks.
  tap: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  link: {
    color: colours.muted,
    fontFamily: fonts.body,
  },
});
