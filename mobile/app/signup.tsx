import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { signup } from '../src/api/auth';
import { ApiError } from '../src/api/client';
import { links } from '../src/config';
import { strings } from '../src/strings';
import {
  BackToWebsiteLink,
  BottomActionBar,
  Checkbox,
  Heading,
  Icon,
  MobileField,
  PasswordField,
  Screen,
  Small,
  TextField,
} from '../src/ui';
import { colours, fonts, spacing, type } from '../src/theme/tokens';

const s = strings.signup;
const MOBILE_PATTERN = /^[6-9][0-9]{9}$/;

function paramString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

type FieldErrors = {
  name?: string;
  mobile?: string;
  password?: string;
  consent?: string;
};

export default function Signup() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
  }>();

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  // Hidden from real users (see styles.honeypot below) — a filled-in value means a bot, not a person.
  const [website, setWebsite] = useState('');

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [showLoginLink, setShowLoginLink] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = s.errors.nameRequired;
    if (!MOBILE_PATTERN.test(mobile)) errors.mobile = s.errors.mobileInvalid;
    if (password.length < 8) errors.password = s.errors.passwordTooShort;
    if (!consent) errors.consent = s.errors.consentRequired;
    return errors;
  }

  async function handleSubmit() {
    const errors = validate();
    setFieldErrors(errors);
    setFormError(null);
    setShowLoginLink(false);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await signup({
        name: name.trim(),
        mobile,
        password,
        email: email.trim(),
        consent,
        utm_source: paramString(params.utm_source),
        utm_medium: paramString(params.utm_medium),
        utm_campaign: paramString(params.utm_campaign),
        website,
      });
      router.replace({ pathname: '/login', params: { mobile, banner: 'created' } });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_MOBILE') {
        setFieldErrors({ mobile: s.errors.duplicateMobile });
        setShowLoginLink(true);
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
      bottomBar={
        <BottomActionBar
          primaryLabel={s.submit}
          onPrimaryPress={handleSubmit}
          primaryLoading={submitting}
        />
      }
    >
      <Heading level={1}>{s.title}</Heading>

      {formError ? (
        <View style={styles.formError}>
          <Icon name="error" size={type.md} colour={colours.danger} />
          <Small style={styles.formErrorText}>{formError}</Small>
        </View>
      ) : null}

      <TextField
        label={s.nameLabel}
        value={name}
        onChangeText={setName}
        placeholder={s.namePlaceholder}
        autoComplete="name"
        error={fieldErrors.name}
      />

      <View style={styles.field}>
        <MobileField
          label={s.mobileLabel}
          value={mobile}
          onChangeText={(text) => setMobile(text.replace(/[^0-9]/g, ''))}
          placeholder={s.mobilePlaceholder}
          hint={fieldErrors.mobile ? undefined : s.mobileHint}
          error={fieldErrors.mobile}
        />
        {showLoginLink ? (
          <InlineLink
            label={s.errors.logInLink}
            onPress={() => router.push({ pathname: '/login', params: { mobile } })}
          />
        ) : null}
      </View>

      <PasswordField
        label={s.passwordLabel}
        value={password}
        onChangeText={setPassword}
        autoComplete="new-password"
        hint={fieldErrors.password ? undefined : s.passwordHint}
        error={fieldErrors.password}
      />

      <TextField
        label={s.emailLabel}
        value={email}
        onChangeText={setEmail}
        placeholder={s.emailPlaceholder}
        keyboardType="email-address"
        autoComplete="email"
      />

      <View style={styles.field}>
        <Checkbox checked={consent} onChange={setConsent} title={s.consentLabel} />
        {fieldErrors.consent ? (
          <View style={styles.formError}>
            <Icon name="error" size={type.md} colour={colours.danger} />
            <Small style={styles.formErrorText}>{fieldErrors.consent}</Small>
          </View>
        ) : null}
        <View style={styles.legalLinks}>
          <LegalLink label={s.privacyLink} url={links.privacyUrl} />
          <LegalLink label={s.termsLink} url={links.termsUrl} />
        </View>
      </View>

      <InlineLink label={s.haveAccount} onPress={() => router.push('/login')} />

      <BackToWebsiteLink />

      {/* Honeypot: invisible and unreachable by tab or screen reader. A real person never fills this
          in; a bot filling every field in the form (including this one) does. */}
      <View
        style={styles.honeypot}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <TextInput value={website} onChangeText={setWebsite} autoComplete="off" aria-hidden />
      </View>
    </Screen>
  );
}

function InlineLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress}>
      <Small style={styles.link}>{label}</Small>
    </Pressable>
  );
}

function LegalLink({ label, url }: { label: string; url: string }) {
  if (!url) {
    return <Small style={styles.legalLinkMuted}>{label}</Small>;
  }
  return (
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL(url)}>
      <Small style={styles.link}>{label}</Small>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  formError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  formErrorText: {
    flex: 1,
    color: colours.danger,
    fontFamily: fonts.bodyExtraBold,
  },
  link: {
    color: colours.primary,
    fontFamily: fonts.bodyExtraBold,
    textDecorationLine: 'underline',
  },
  legalLinks: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  legalLinkMuted: {
    color: colours.muted,
    fontFamily: fonts.bodyExtraBold,
  },
  honeypot: {
    position: 'absolute',
    display: 'none',
  },
});
