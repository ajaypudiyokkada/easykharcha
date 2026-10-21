import { Redirect } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { Business } from '../../src/api/business';
import { ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import {
  BusinessForm,
  EMPTY_BUSINESS_DRAFT,
  type BusinessDraft,
} from '../../src/forms/BusinessForm';
import { strings } from '../../src/strings';
import { colours, fonts, spacing, type } from '../../src/theme/tokens';
import { AppShell, Body, Button, Heading, Icon, NoAccess, Screen, Toast } from '../../src/ui';
import { HOME_CONTENT_WIDTH } from '../../src/ui/constants';

const s = strings.settings.business;

type FieldErrors = { name?: string; businessType?: string; city?: string };

export default function BusinessDetailsSettings() {
  const { status, user, businesses, authedFetch, refreshMe } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [draft, setDraft] = useState<BusinessDraft>(EMPTY_BUSINESS_DRAFT);
  const [loaded, setLoaded] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // `business` isn't there yet on the very first render while auth is still bootstrapping (e.g. a
  // hard refresh landing straight on this route) — fills the form in once it is, instead of a
  // one-time useState initializer that would otherwise freeze on an empty business forever.
  useEffect(() => {
    if (!business || loaded) return;
    setDraft({
      name: business.name,
      businessType: business.business_type as BusinessDraft['businessType'],
      city: business.city,
      pincode: business.pincode,
      state: business.state,
      manualLocation: false,
      tagline: business.tagline,
    });
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
  if (!can(permissions, 'settings.manage')) {
    return (
      <AppShell active="settings">
        <Screen maxWidth={HOME_CONTENT_WIDTH}>
          <NoAccess />
        </Screen>
      </AppShell>
    );
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!draft.name.trim()) errors.name = s.errors.nameRequired;
    if (!draft.businessType) errors.businessType = s.errors.typeRequired;
    if (!draft.city.trim()) errors.city = s.errors.cityRequired;
    return errors;
  }

  async function handleSave() {
    const errors = validate();
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0 || !business) return;

    setSaving(true);
    try {
      await authedFetch<Business>(`/businesses/${business.id}/`, {
        method: 'PATCH',
        body: {
          name: draft.name.trim(),
          business_type: draft.businessType,
          city: draft.city.trim(),
          pincode: draft.pincode,
          state: draft.state,
          manual_location: draft.manualLocation,
          tagline: draft.tagline.trim(),
        },
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

        <BusinessForm
          value={draft}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          authedFetch={authedFetch}
          errors={fieldErrors}
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
