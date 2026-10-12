import React from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { links } from '../config';
import { strings } from '../strings';
import { colours, fonts } from '../theme/tokens';
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
      onPress={() => {
        window.location.href = links.landingUrl;
      }}
    >
      <Small style={styles.link}>{strings.app.backToWebsite}</Small>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    color: colours.muted,
    fontFamily: fonts.body,
  },
});
