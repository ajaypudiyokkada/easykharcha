import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { useSession } from '../src/state/session';
import { spacing } from '../src/theme';
import { Body, Button, Caption, Card, ErrorNotice, Field, Screen, Title, usePalette } from '../src/ui';

export default function Login() {
  const palette = usePalette();
  const { signIn } = useSession();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await signIn(phone, pin);
      router.replace('/');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ paddingTop: spacing.xxl, gap: spacing.xs }}>
        <Title>EasyKharcha</Title>
        <Caption>Know what you bought, what you sold, and what went missing.</Caption>
      </View>

      <Card>
        <Field
          label="Phone number"
          value={phone}
          onChangeText={setPhone}
          placeholder="10-digit number"
          keyboardType="phone-pad"
          autoFocus
        />
        <Field
          label="PIN"
          value={pin}
          onChangeText={setPin}
          placeholder="••••"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={8}
        />
        <ErrorNotice error={error} />
        <View style={{ height: spacing.sm }} />
        <Button label="Sign in" onPress={submit} busy={busy} disabled={!phone || !pin} />
      </Card>

      <Body muted>
        No account is created by signing in. An Owner or Super Admin adds you, then you set your own PIN.
      </Body>
      <Caption tone="textFaint">Powered by EasyKharcha · {palette.mode} theme</Caption>
    </Screen>
  );
}
