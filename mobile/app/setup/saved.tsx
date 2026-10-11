import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../../src/auth/AuthContext';
import { getOnboardingBusiness } from '../../src/business/routing';
import { strings } from '../../src/strings';
import { Banner, Button, Heading, Muted, Screen } from '../../src/ui';
import { colours } from '../../src/theme/tokens';

const s = strings.setup.saved;

const STEP_TITLES: Record<number, string> = {
  1: strings.setup.step1.title,
  2: strings.setup.step2.title,
  3: strings.setup.step3.title,
  4: strings.setup.step4.title,
};

/** A temporary stand-in for step 5 of the wizard, which doesn't exist yet. */
export default function SetupSaved() {
  const router = useRouter();
  const { status, businesses } = useAuth();

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

  const business = getOnboardingBusiness(businesses);
  const skippedSteps = (business?.onboarding ?? [])
    .filter((step) => step.status === 'skipped')
    .map((step) => STEP_TITLES[step.step] ?? `Step ${step.step}`);

  return (
    <Screen>
      <Heading level={1}>{s.title}</Heading>
      <Banner kind="success">{s.message}</Banner>
      {skippedSteps.length > 0 ? (
        <Muted>
          {s.skippedPrefix}
          {skippedSteps.join(', ')}
        </Muted>
      ) : null}
      <Button label={s.goHome} variant="primary" onPress={() => router.replace('/home')} />
    </Screen>
  );
}
