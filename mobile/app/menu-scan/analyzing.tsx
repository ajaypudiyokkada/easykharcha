import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { MenuScanDetail } from '../../src/api/menuScan';
import { useAuth } from '../../src/auth/AuthContext';
import { menuScanDraft } from '../../src/screens/menuScanDraft';
import { sectorCopyFor } from '../../src/sectorCopy';
import { strings } from '../../src/strings';
import { Banner, Button, Heading, Screen, Small } from '../../src/ui';
import { colours, spacing } from '../../src/theme/tokens';

const sa = strings.menuScan.analyzing;

const POLL_INTERVAL_MS = 3000;
const POLL_BACKOFF_MS = 6000;
const BACKOFF_AFTER_MS = 30_000;
const TAKING_A_WHILE_AFTER_MS = 20_000;

export default function MenuScanAnalyzing() {
  const router = useRouter();
  const { status, businesses, authedFetch } = useAuth();
  const params = useLocalSearchParams<{ businessId?: string; returnTo?: string }>();
  const returnTo = params.returnTo === 'settings' ? 'settings' : 'onboarding';
  const backPath = returnTo === 'settings' ? '/settings/sell' : '/setup/4';
  const manualPath = returnTo === 'onboarding' ? `${backPath}?mode=manual` : backPath;

  const business = businesses.find((b) => String(b.id) === params.businessId) ?? businesses[0];

  const [elapsedMs, setElapsedMs] = useState(0);
  const [failed, setFailed] = useState(false);
  const stopped = useRef(false);

  useEffect(() => {
    if (!business) return;
    stopped.current = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      const draft = await menuScanDraft.load(business.id);
      if (!draft || stopped.current) return;
      try {
        const scan = await authedFetch<MenuScanDetail>(
          `/businesses/${business.id}/ai/menu-scans/${draft.scanId}/`,
        );
        if (stopped.current) return;
        if (scan.status === 'done') {
          await menuScanDraft.clear(business.id);
          router.replace(
            `/menu-scan/review?businessId=${business.id}&scanId=${scan.id}&returnTo=${returnTo}`,
          );
          return;
        }
        if (scan.status === 'failed') {
          await menuScanDraft.clear(business.id);
          setFailed(true);
          return;
        }
      } catch {
        // A transient network hiccup mid-poll isn't a scan failure — just try again next tick.
      }
      setElapsedMs(Date.now() - startedAt);
      const delay = Date.now() - startedAt >= BACKOFF_AFTER_MS ? POLL_BACKOFF_MS : POLL_INTERVAL_MS;
      timer = setTimeout(poll, delay);
    }

    poll();
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

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

  const noun = sectorCopyFor(business.business_type).menuNoun;

  if (failed) {
    return (
      <Screen>
        <Banner kind="error">{sa.errors.scanFailed}</Banner>
        <View style={styles.actions}>
          <Button
            label={sa.errors.tryAgain}
            onPress={() =>
              router.replace(`/menu-scan?businessId=${business.id}&returnTo=${returnTo}`)
            }
          />
          <Button
            label={sa.errors.addOneByOne}
            variant="secondary"
            onPress={() => router.replace(manualPath)}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.centre}>
        <ActivityIndicator size="large" color={colours.primary} />
        <Heading level={2} style={styles.title}>
          {sa.title(noun)}
        </Heading>
        {elapsedMs >= TAKING_A_WHILE_AFTER_MS ? (
          <Small style={styles.muted}>{sa.takingAWhile}</Small>
        ) : null}
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
  title: {
    textAlign: 'center',
  },
  muted: {
    color: colours.muted,
    textAlign: 'center',
  },
  actions: {
    gap: spacing.sm,
  },
});
