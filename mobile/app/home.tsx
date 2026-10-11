import { Redirect } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../src/auth/AuthContext';
import { strings } from '../src/strings';
import { Body, Button, Heading, Screen } from '../src/ui';
import { colours } from '../src/theme/tokens';

const s = strings.home;

/** A temporary placeholder after login — Step 7 replaces this with the real home screen. */
export default function Home() {
  const { status, user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  if (status === 'bootstrapping') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colours.background,
        }}
      >
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }
  if (status === 'signedOut' || !user) {
    return <Redirect href="/login" />;
  }

  async function handleLogout() {
    setLoggingOut(true);
    // No explicit navigation here — logout() flips `status` to 'signedOut', and the Redirect
    // above reacts to that. (An explicit router.replace alongside a reactive Redirect raced
    // against each other the last time this pattern was tried.)
    await logout();
  }

  return (
    <Screen>
      <Heading level={1}>{s.greeting(user.name)}</Heading>
      <Body>{s.subtitle}</Body>
      <Button label={s.logOut} variant="secondary" onPress={handleLogout} loading={loggingOut} />
    </Screen>
  );
}
