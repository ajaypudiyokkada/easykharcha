import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../../src/auth/AuthContext';
import { strings } from '../../src/strings';
import { Banner, Button, Heading, Screen } from '../../src/ui';
import { colours } from '../../src/theme/tokens';

const s = strings.setup.saved;

/** A temporary stand-in for step 3 of the wizard, which doesn't exist yet. */
export default function SetupSaved() {
  const router = useRouter();
  const { status } = useAuth();

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
  if (status === 'signedOut') {
    return <Redirect href="/login" />;
  }

  return (
    <Screen>
      <Heading level={1}>{s.title}</Heading>
      <Banner kind="success">{s.message}</Banner>
      <Button label={s.goHome} variant="primary" onPress={() => router.replace('/home')} />
    </Screen>
  );
}
