import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useAuth } from '../src/auth/AuthContext';
import { ApiError } from '../src/api/client';
import { nextRouteAfterAuth } from '../src/business/routing';
import { strings } from '../src/strings';
import {
  BackToWebsiteLink,
  Banner,
  BottomActionBar,
  Heading,
  MobileField,
  Screen,
  Small,
  TextField,
  Wordmark,
} from '../src/ui';
import { AUTH_CARD_WIDTH, MIN_TOUCH_TARGET } from '../src/ui/constants';
import { colours, fonts, spacing } from '../src/theme/tokens';

const s = strings.login;

function paramString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default function Login() {
  const router = useRouter();
  const { status, login } = useAuth();
  const params = useLocalSearchParams<{ mobile?: string; banner?: string }>();

  const [mobile, setMobile] = useState(paramString(params.mobile));
  const [password, setPassword] = useState('');
  const [mobileError, setMobileError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'bootstrapping') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }
  if (status === 'signedIn') {
    return <Redirect href="/home" />;
  }

  async function handleSubmit() {
    const nextMobileError = mobile ? undefined : s.errors.mobileRequired;
    const nextPasswordError = password ? undefined : s.errors.passwordRequired;
    setMobileError(nextMobileError);
    setPasswordError(nextPasswordError);
    setFormError(null);
    if (nextMobileError || nextPasswordError) return;

    setSubmitting(true);
    try {
      const { businesses } = await login(mobile, password);
      router.replace(nextRouteAfterAuth(businesses));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_credentials') {
        setPasswordError(s.errors.invalidCredentials);
      } else if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
        setFormError(s.errors.network);
      } else if (err instanceof ApiError && err.code === 'rate_limited') {
        setFormError(s.errors.rateLimited);
      } else if (err instanceof ApiError) {
        setFormError(err.message || s.errors.generic);
      } else {
        setFormError(s.errors.generic);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      maxWidth={AUTH_CARD_WIDTH}
      bottomBar={
        <BottomActionBar
          primaryLabel={s.submit}
          onPrimaryPress={handleSubmit}
          primaryLoading={submitting}
        />
      }
    >
      <Wordmark size="auth" style={styles.wordmark} />
      <Heading level={1}>{s.title}</Heading>

      {params.banner === 'created' ? <Banner kind="success">{s.createdBanner}</Banner> : null}
      {formError ? <Banner kind="error">{formError}</Banner> : null}

      <MobileField
        label={s.mobileLabel}
        value={mobile}
        onChangeText={(text) => setMobile(text.replace(/[^0-9]/g, ''))}
        placeholder={s.mobilePlaceholder}
        error={mobileError}
      />

      <TextField
        label={s.passwordLabel}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        error={passwordError}
      />

      <Pressable
        accessibilityRole="link"
        style={styles.linkTap}
        onPress={() => router.push('/signup')}
      >
        <Small style={styles.link}>{s.newHere}</Small>
      </Pressable>

      <Small style={styles.hint}>{s.teamMemberHint}</Small>

      <BackToWebsiteLink />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wordmark: {
    marginBottom: spacing.sm,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  linkTap: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  link: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
    textDecorationLine: 'underline',
  },
  hint: {
    color: colours.muted,
    marginTop: -spacing.md,
  },
});
