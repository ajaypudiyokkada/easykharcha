import { Redirect } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { Business } from '../../src/api/business';
import { ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { BrandForm } from '../../src/forms/BrandForm';
import { strings } from '../../src/strings';
import { colours, fonts, spacing, type } from '../../src/theme/tokens';
import { AppShell, Body, Button, Heading, Icon, NoAccess, Screen, Toast } from '../../src/ui';
import { HOME_CONTENT_WIDTH } from '../../src/ui/constants';

const s = strings.settings.brand;

export default function BrandSettings() {
  const { status, user, businesses, authedFetch, refreshMe } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [colour, setColour] = useState('#1F6F63');
  const [logoUri, setLogoUri] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // `business` isn't there yet on the very first render while auth is still bootstrapping (e.g. a
  // hard refresh landing straight on this route) — fills the form in once it is, instead of a
  // one-time useState initializer that would otherwise freeze on the fallback colour forever.
  useEffect(() => {
    if (!business || loaded) return;
    setColour(business.primary_colour);
    setLogoUri(business.logo ?? undefined);
    setLoaded(true);
  }, [business, loaded]);

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
  if (!can(permissions, 'settings.manage') || !business) {
    return (
      <AppShell active="settings">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  async function handleSave() {
    setFormError(null);
    setSaving(true);
    try {
      await authedFetch<Business>(`/businesses/${business.id}/`, {
        method: 'PATCH',
        body: { primary_colour: colour },
      });
      await refreshMe();
      setToast(s.savedToast);
    } catch (err) {
      if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
        setFormError(s.errors.network);
      } else if (err instanceof ApiError) {
        setFormError(err.message || s.errors.generic);
      } else {
        setFormError(s.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell active="settings">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{s.title}</Heading>

        {formError ? (
          <View style={styles.formError}>
            <Icon name="error" size={type.md} colour={colours.danger} />
            <Body style={styles.formErrorText}>{formError}</Body>
          </View>
        ) : null}

        <BrandForm
          business={business}
          authedFetch={authedFetch}
          colour={colour}
          onColourChange={setColour}
          logoUri={logoUri}
          onLogoChange={setLogoUri}
          onError={(message) => setFormError(message)}
        />

        <Button label={s.save} variant="primary" onPress={handleSave} loading={saving} />
      </Screen>
      <Toast message={toast} onHide={() => setToast(null)} />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
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
});
