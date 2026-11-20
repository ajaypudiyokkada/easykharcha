import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { InvoiceSettings } from '../../src/api/invoices';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { parseScaled } from '../../src/invoices/money';
import { strings } from '../../src/strings';
import { colours, radii, spacing } from '../../src/theme/tokens';
import {
  Banner,
  Body,
  Button,
  Heading,
  Icon,
  NoAccess,
  Screen,
  Small,
  TextField,
  Toggle,
} from '../../src/ui';
import { MIN_TOUCH_TARGET } from '../../src/ui/constants';

const s = strings.invoice.settings;
const FORM_PATH = '/invoices/new';

type FieldErrors = { rate?: string; address?: string; phone?: string; gstin?: string };

/** A tax rate from 0 to 100 with at most 2 decimals, in hundredths of a percent; null if it isn't one. */
function parseRate(text: string): number | null {
  const hundredths = parseScaled(text, 2);
  return hundredths !== null && hundredths <= 10000 ? hundredths : null;
}

export default function InvoiceSettingsScreen() {
  const router = useRouter();
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];
  const isOwner = can(permissions, 'settings.manage');

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxRate, setTaxRate] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [gstin, setGstin] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    if (!business || !isOwner) return;
    authedFetch<InvoiceSettings>(`/businesses/${business.id}/invoice-settings/`)
      .then((row) => {
        setTaxEnabled(row.invoice_tax_enabled);
        setTaxRate(Number(row.invoice_tax_rate) === 0 ? '' : String(Number(row.invoice_tax_rate)));
        setAddress(row.bill_address);
        setPhone(row.bill_phone);
        setGstin(row.bill_gstin);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, [authedFetch, business, isOwner]);

  if (status === 'bootstrapping' || (status === 'signedIn' && business && isOwner && loading)) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }
  if (status === 'signedOut' || !user) {
    return <Redirect href="/login" />;
  }
  if (!business) {
    return (
      <Screen>
        <NoAccess />
      </Screen>
    );
  }
  // A Manager can create invoices but not change bill settings: send them back to the form.
  if (!isOwner) {
    return <Redirect href={FORM_PATH} />;
  }

  const businessId = business.id;

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (taxEnabled) {
      if (!taxRate.trim()) next.rate = s.errors.rateRequired;
      else if (parseRate(taxRate) === null) next.rate = s.errors.rateInvalid;
    }
    if (address.length > 240) next.address = s.errors.addressLong;
    if (phone.length > 20) next.phone = s.errors.phoneLong;
    if (gstin.length > 20) next.gstin = s.errors.gstinLong;
    return next;
  }

  async function save() {
    setSaved(false);
    setSaveFailed(false);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      const row = await authedFetch<InvoiceSettings>(
        `/businesses/${businessId}/invoice-settings/`,
        {
          method: 'PATCH',
          body: {
            invoice_tax_enabled: taxEnabled,
            // The rate is only sent while tax is on; turning tax off keeps the stored rate as it was.
            ...(taxEnabled ? { invoice_tax_rate: String((parseRate(taxRate) ?? 0) / 100) } : {}),
            bill_address: address.trim(),
            bill_phone: phone.trim(),
            bill_gstin: gstin.trim(),
          },
        },
      );
      setTaxEnabled(row.invoice_tax_enabled);
      setSaved(true);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.replace(FORM_PATH)}
            style={styles.backBtn}
          >
            <Icon name="back" size={22} colour={colours.text} />
          </Pressable>
          <Heading level={2}>{s.title}</Heading>
        </View>
        <Small style={styles.muted}>{s.subtitle}</Small>

        {loadFailed ? <Banner kind="error">{s.loadFailed}</Banner> : null}
        {saveFailed ? <Banner kind="error">{s.saveFailed}</Banner> : null}
        {saved ? <Banner kind="success">{s.saved}</Banner> : null}

        <Toggle
          value={taxEnabled}
          onChange={(value) => {
            setTaxEnabled(value);
            setSaved(false);
          }}
          title={s.taxToggle}
          helpText={s.taxToggleHelp}
        />
        {taxEnabled ? (
          <>
            <TextField
              label={s.taxRate}
              value={taxRate}
              onChangeText={(text) => {
                setTaxRate(text.replace(/[^0-9.]/g, ''));
                setSaved(false);
              }}
              keyboardType="decimal-pad"
              maxLength={6}
              error={errors.rate}
            />
            <Small style={styles.muted}>{s.taxNote}</Small>
          </>
        ) : null}

        <TextField
          label={s.address}
          value={address}
          onChangeText={(text) => {
            setAddress(text);
            setSaved(false);
          }}
          error={errors.address}
        />
        <TextField
          label={s.phone}
          value={phone}
          onChangeText={(text) => {
            setPhone(text);
            setSaved(false);
          }}
          keyboardType="phone-pad"
          error={errors.phone}
        />
        <TextField
          label={s.gstin}
          value={gstin}
          onChangeText={(text) => {
            setGstin(text);
            setSaved(false);
          }}
          error={errors.gstin}
        />
        <Body style={styles.muted}>{s.note}</Body>

        <Button label={s.save} variant="primary" onPress={save} loading={saving} />
        <Button label={s.cancel} variant="secondary" onPress={() => router.replace(FORM_PATH)} />
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
  page: { gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  backBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
  },
  muted: { color: colours.muted },
});
