import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '../src/api/client';
import { colours, fonts, radii, spacing, type } from '../src/theme/tokens';

type Status = 'checking' | 'connected' | 'error';
type HealthResponse = { status: string; version: string; database: string };

/**
 * The one screen for Step 1: prove the app can reach the API. Everything else waits for later steps.
 */
export default function Index() {
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
    <View style={styles.screen}>
      <View style={styles.content}>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colours.background,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.huge,
  },
  content: {
    width: '100%',
    gap: spacing.xl,
  },
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
