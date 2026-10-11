import { Redirect } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../src/auth/AuthContext';
import { bestTextOn, ensureContrast } from '../src/theme/brand';
import { strings } from '../src/strings';
import { Body, Button, Heading, Muted, Screen } from '../src/ui';
import { colours } from '../src/theme/tokens';

const s = strings.home;

/** A temporary placeholder after login — Step 7 replaces this with the real home screen. */
export default function Home() {
  const { status, user, businesses, logout } = useAuth();
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

  const business = businesses[0];
  // Presets already pass; a custom colour may have been darkened at save time — this just reads
  // whatever is stored, so it's correct either way without redoing that work here.
  const brandColour = business ? ensureContrast(business.primary_colour).colour : undefined;
  const brandTextColour = business ? bestTextOn(business.primary_colour) : undefined;

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
      {business ? <Muted>{business.name}</Muted> : null}
      <Body>{s.subtitle}</Body>
      <Button
        label={s.logOut}
        variant="primary"
        colour={brandColour}
        textColour={brandTextColour}
        onPress={handleLogout}
        loading={loggingOut}
      />
    </Screen>
  );
}
