import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '../src/auth/AuthContext';
import { nextRouteAfterAuth } from '../src/business/routing';
import { colours } from '../src/theme/tokens';

/**
 * The real landing route: never a screen of its own, just a dispatcher to wherever a visitor
 * actually belongs. `status === 'offline'` is intercepted by the root layout before this ever
 * renders — see app/_layout.tsx's RootShell.
 */
export default function Index() {
  const { status, businesses } = useAuth();

  if (status === 'bootstrapping') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }
  if (status === 'signedOut') {
    return <Redirect href="/login" />;
  }
  return <Redirect href={nextRouteAfterAuth(businesses)} />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
});
