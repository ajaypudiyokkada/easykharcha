import { useRouter } from 'expo-router';
import React from 'react';

import { strings } from '../src/strings';
import { Body, Button, Heading, Screen } from '../src/ui';

const s = strings.app.notFound;

export default function NotFound() {
  const router = useRouter();

  return (
    <Screen>
      <Heading level={1}>{s.title}</Heading>
      <Body>{s.body}</Body>
      <Button label={s.goHome} variant="primary" onPress={() => router.replace('/home')} />
    </Screen>
  );
}
