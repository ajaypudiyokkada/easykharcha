import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '../../src/auth/AuthContext';
import { sectorCopyFor } from '../../src/sectorCopy';
import { strings } from '../../src/strings';
import { Body, Button, Icon, Screen } from '../../src/ui';
import { colours, radii, spacing } from '../../src/theme/tokens';

const sdone = strings.menuScan.done;

export default function MenuScanDone() {
  const router = useRouter();
  const { status, businesses, authedFetch } = useAuth();
  const params = useLocalSearchParams<{
    businessId?: string;
    returnTo?: string;
    count?: string;
    suggestCount?: string;
  }>();
  const returnTo = params.returnTo === 'settings' ? 'settings' : 'onboarding';
  const count = Number(params.count ?? '0');
  // Step EK-4c-2: EK apply's own hand-off — the starting-stock step (`/count`) couldn't take the
  // newly created items right now (today's opening count is already done/locked), so this screen
  // offers it as a prominent extra action instead of silently dropping the suggestion.
  const suggestCount = params.suggestCount === '1';

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
    // Step O2: menu-scan/ek.tsx leaves onboarding_step on its own "starting stock count offered"
    // marker (4) while this screen is up — reset it to 2 (brand, the next real wizard screen) so a
    // resume interrupted right after this point lands on brand, not back here or at /count again.
    try {
      await authedFetch(`/businesses/${business.id}/`, {
        method: 'PATCH',
        body: { onboarding_step: 2 },
      });
    } catch {
      // Best-effort — setup/2 re-derives everything it needs from the business itself.
    }
    router.replace('/setup/2');
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
        {suggestCount ? (
          <Button label={sdone.countStarting} onPress={() => router.replace('/count')} />
        ) : null}
        <Button
          label={sdone.continueLabel}
          variant={suggestCount ? 'secondary' : 'primary'}
          onPress={handleContinue}
        />
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
