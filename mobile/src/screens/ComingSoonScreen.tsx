import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { strings } from '../strings';
import { colours } from '../theme/tokens';
import { AppShell, Body, Button, Heading, Icon, Screen, type NavKey } from '../ui';

/** The "nothing here yet" page for any nav item that isn't built — Reports, Sales, Wastage, Alerts,
 * and (for now) Team/Settings. One component so every placeholder looks and behaves identically. */
export function ComingSoonScreen({ featureName, navKey }: { featureName: string; navKey: NavKey }) {
  const router = useRouter();
  const { status } = useAuth();
  const s = strings.comingSoon;

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

  return (
    <AppShell active={navKey}>
      <Screen>
        <Icon name="clock" size={40} colour={colours.muted} />
        <Heading level={1}>{s.title(featureName)}</Heading>
        <Body style={styles.body}>{s.body}</Body>
        <Button label={s.goHome} variant="primary" onPress={() => router.replace('/home')} />
      </Screen>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  body: {
    color: colours.muted,
  },
});
