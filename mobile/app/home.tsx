import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';

import { useAuth } from '../src/auth/AuthContext';
import { bestTextOn, ensureContrast } from '../src/theme/brand';
import { strings } from '../src/strings';
import { Body, Button, Card, Heading, Muted, Screen, Small } from '../src/ui';
import { HOME_CONTENT_WIDTH } from '../src/ui/constants';
import { colours, fonts, radii, spacing, type } from '../src/theme/tokens';

const s = strings.home;

export default function Home() {
  const router = useRouter();
  const { status, user, businesses, authedFetch, refreshMe, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  if (status === 'bootstrapping') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }
  if (status === 'signedOut' || !user) {
    return <Redirect href="/login" />;
  }

  const business = businesses[0];
  const isOwner = business?.role === 'owner';
  const skippedSteps = business?.skipped_steps ?? [];
  const checklistDismissed = Boolean(business?.checklist_dismissed_at);
  const showChecklist = isOwner && skippedSteps.length > 0 && !checklistDismissed;

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

  async function handleDismissChecklist() {
    if (!business) return;
    setDismissing(true);
    try {
      await authedFetch(`/businesses/${business.id}/`, {
        method: 'PATCH',
        body: { dismiss_checklist: true },
      });
      await refreshMe();
    } finally {
      setDismissing(false);
    }
  }

  return (
    <Screen maxWidth={HOME_CONTENT_WIDTH}>
      {isOwner && business ? (
        <View style={[styles.brandHeader, { backgroundColor: brandColour }]}>
          {business.logo ? <Image source={{ uri: business.logo }} style={styles.logo} /> : null}
          <Heading level={1} style={{ color: brandTextColour }}>
            {business.name}
          </Heading>
        </View>
      ) : (
        <View>
          <Heading level={1}>{s.greeting(user.name)}</Heading>
          {business ? <Muted>{business.name}</Muted> : null}
        </View>
      )}

      {showChecklist ? (
        <Card>
          <View style={styles.checklistHeader}>
            <Body style={styles.checklistTitle}>{s.checklistTitle}</Body>
            <Pressable
              accessibilityRole="button"
              onPress={handleDismissChecklist}
              disabled={dismissing}
            >
              <Small style={styles.dismissLink}>{s.dismissChecklist}</Small>
            </Pressable>
          </View>
          {skippedSteps.map((step) => (
            <View key={step} style={styles.checklistRow}>
              <Body style={styles.checklistStepTitle}>{s.stepTitles[step] ?? `Step ${step}`}</Body>
              <Pressable accessibilityRole="button" onPress={() => router.push(`/setup/${step}`)}>
                <Small style={styles.continueLink}>{s.continueStep}</Small>
              </Pressable>
            </View>
          ))}
        </Card>
      ) : null}

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

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  brandHeader: {
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: radii.sm,
  },
  checklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  checklistTitle: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: type.md,
  },
  dismissLink: {
    color: colours.muted,
    fontFamily: fonts.bodyExtraBold,
    textDecorationLine: 'underline',
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  checklistStepTitle: {
    flex: 1,
  },
  continueLink: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
    textDecorationLine: 'underline',
  },
});
