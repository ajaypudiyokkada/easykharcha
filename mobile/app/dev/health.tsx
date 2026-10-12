import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '../../src/api/client';
import { Screen } from '../../src/ui';
import { colours, fonts, radii, spacing, type } from '../../src/theme/tokens';

type Status = 'checking' | 'connected' | 'error';
type HealthResponse = { status: string; version: string; database: string };

/**
 * Step 1's original screen: proves the app can reach the API. Moved off "/" in Step 8b (the real app
 * lives there now — see app/index.tsx) and kept as a dev-only diagnostic. `__DEV__` is React Native's
 * standard flag for this, false in a release build, so this route renders nothing there.
 */
export default function Health() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <HealthScreen />;
}

function HealthScreen() {
  const [status, setStatus] = useState<Status>('checking');

  const checkHealth = useCallback(() => {
    setStatus('checking');
    api<HealthResponse>('/health/')
      .then(() => setStatus('connected'))
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  return (
    <Screen>
      <Text style={styles.wordmark}>EasyKharcha</Text>

      {status === 'checking' ? (
        <View style={[styles.banner, styles.bannerNeutral]}>
          <ActivityIndicator color={colours.muted} />
          <Text style={styles.bannerText}>Checking the server…</Text>
        </View>
      ) : null}

      {status === 'connected' ? (
        <View style={[styles.banner, styles.bannerSuccess]}>
          <Text style={[styles.bannerGlyph, styles.successText]} accessibilityElementsHidden>
            ✓
          </Text>
          <Text style={[styles.bannerText, styles.successText]}>Connected to the server</Text>
        </View>
      ) : null}

      {status === 'error' ? (
        <View style={[styles.banner, styles.bannerDanger]}>
          <Text style={[styles.bannerGlyph, styles.dangerText]} accessibilityElementsHidden>
            ⚠
          </Text>
          <Text style={[styles.bannerText, styles.dangerText]}>
            {"Can't reach the server. Is the backend running?"}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={checkHealth}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wordmark: {
    fontFamily: fonts.headingBold,
    fontSize: type.xxl,
    color: colours.text,
    textAlign: 'center',
  },
  banner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  bannerNeutral: {
    backgroundColor: colours.card,
  },
  bannerSuccess: {
    backgroundColor: colours.mint,
  },
  bannerDanger: {
    backgroundColor: colours.card,
    borderWidth: 1,
    borderColor: colours.danger,
  },
  bannerGlyph: {
    fontSize: type.lg,
  },
  bannerText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: type.md,
    color: colours.text,
  },
  successText: {
    color: colours.success,
  },
  dangerText: {
    color: colours.danger,
  },
  button: {
    minHeight: spacing.huge,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.sm,
    backgroundColor: colours.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    fontFamily: fonts.bodyBold,
    fontSize: type.md,
    color: colours.card,
  },
});
