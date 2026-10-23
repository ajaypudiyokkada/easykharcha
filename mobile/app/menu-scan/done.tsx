import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '../../src/auth/AuthContext';
import { sectorCopyFor } from '../../src/sectorCopy';
import { strings } from '../../src/strings';
import { Body, Button, Icon, Screen } from '../../src/ui';
import { colours, radii, spacing } from '../../src/theme/tokens';

const sdone = strings.menuScan.done;

export default function MenuScanDone() {
  const router = useRouter();
  const { status, businesses, authedFetch, refreshMe } = useAuth();
  const params = useLocalSearchParams<{ businessId?: string; returnTo?: string; count?: string }>();
  const returnTo = params.returnTo === 'settings' ? 'settings' : 'onboarding';
  const count = Number(params.count ?? '0');
  const [continuing, setContinuing] = useState(false);

  const business = businesses.find((b) => String(b.id) === params.businessId) ?? businesses[0];

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
  if (!business) {
    return <Redirect href="/home" />;
  }

  const sector = sectorCopyFor(business.business_type);

  async function handleContinue() {
    if (returnTo === 'settings') {
      router.replace('/settings/sell');
      return;
    }
    setContinuing(true);
    try {
      await authedFetch(`/businesses/${business.id}/onboarding/4/`, {
        method: 'PATCH',
        body: { status: 'done' },
      });
      await authedFetch(`/businesses/${business.id}/`, {
        method: 'PATCH',
        body: { onboarding_step: 5 },
      });
      await refreshMe();
      router.replace('/setup/5');
    } finally {
      setContinuing(false);
    }
  }

  return (
    <Screen>
      <View style={styles.centre}>
        <View style={styles.iconWrap}>
          <Icon name="success" size={32} colour={colours.card} />
        </View>
        <Body style={styles.title}>
          {sdone.title(count, sector.sellNoun, sector.sellNounPlural)}
        </Body>
        <Body style={styles.subtitle}>{sdone.subtitle}</Body>
        <Button label={sdone.continueLabel} onPress={handleContinue} loading={continuing} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  centre: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.huge,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    backgroundColor: colours.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    color: colours.muted,
  },
});
