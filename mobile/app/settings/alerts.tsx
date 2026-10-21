import { Redirect } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { BusinessSettings } from '../../src/api/business';
import { ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { can } from '../../src/auth/permissions';
import { DEFAULT_BUSINESS_SETTINGS } from '../../src/constants/businessSettings';
import { targetCostHint } from '../../src/sectorCopy';
import { strings } from '../../src/strings';
import { colours, fonts, spacing, type } from '../../src/theme/tokens';
import {
  AppShell,
  Body,
  Button,
  Heading,
  Icon,
  NoAccess,
  Screen,
  TextField,
  Toast,
} from '../../src/ui';
import { HOME_CONTENT_WIDTH } from '../../src/ui/constants';

const s6 = strings.setup.step6;
const sa = strings.settings.alerts;

export default function AlertRulesSettings() {
  const { status, user, businesses, authedFetch } = useAuth();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];

  const [countDeadlineHour, setCountDeadlineHour] = useState(
    String(DEFAULT_BUSINESS_SETTINGS.count_deadline_hour),
  );
  const [closingCountHour, setClosingCountHour] = useState(
    String(DEFAULT_BUSINESS_SETTINGS.closing_count_hour),
  );
  const [targetCostPct, setTargetCostPct] = useState(
    String(DEFAULT_BUSINESS_SETTINGS.target_cost_pct),
  );
  const [wastageAlertPct, setWastageAlertPct] = useState(
    String(DEFAULT_BUSINESS_SETTINGS.wastage_alert_pct),
  );
  const [rateCreepPct, setRateCreepPct] = useState(
    String(DEFAULT_BUSINESS_SETTINGS.rate_creep_pct),
  );
  const [gapAlertPct, setGapAlertPct] = useState(String(DEFAULT_BUSINESS_SETTINGS.gap_alert_pct));
  const [expiryWarnDays, setExpiryWarnDays] = useState(
    String(DEFAULT_BUSINESS_SETTINGS.expiry_warn_days),
  );

  const [loading, setLoading] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [usingRecommended, setUsingRecommended] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!business) return;
    authedFetch<BusinessSettings>(`/businesses/${business.id}/settings/`)
      .then((settings) => {
        setCountDeadlineHour(String(settings.count_deadline_hour));
        setClosingCountHour(String(settings.closing_count_hour));
        setTargetCostPct(settings.target_cost_pct);
        setWastageAlertPct(settings.wastage_alert_pct);
        setRateCreepPct(settings.rate_creep_pct);
        setGapAlertPct(settings.gap_alert_pct);
        setExpiryWarnDays(String(settings.expiry_warn_days));
      })
      .catch(() => {
        // Keep the recommended defaults already in state — this is only a pre-fill.
      })
      .finally(() => setLoading(false));
    // Fetches once for this business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

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

  function mapError(err: unknown) {
    if (err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')) {
      setFormError(sa.errors.network);
    } else if (err instanceof ApiError) {
      setFormError(err.message || sa.errors.generic);
    } else {
      setFormError(sa.errors.generic);
    }
  }

  async function handleUseRecommended() {
    setFormError(null);
    setUsingRecommended(true);
    try {
      await authedFetch(`/businesses/${business.id}/settings/`, {
        method: 'PATCH',
        body: DEFAULT_BUSINESS_SETTINGS,
      });
      setCountDeadlineHour(String(DEFAULT_BUSINESS_SETTINGS.count_deadline_hour));
      setClosingCountHour(String(DEFAULT_BUSINESS_SETTINGS.closing_count_hour));
      setTargetCostPct(String(DEFAULT_BUSINESS_SETTINGS.target_cost_pct));
      setWastageAlertPct(String(DEFAULT_BUSINESS_SETTINGS.wastage_alert_pct));
      setRateCreepPct(String(DEFAULT_BUSINESS_SETTINGS.rate_creep_pct));
      setGapAlertPct(String(DEFAULT_BUSINESS_SETTINGS.gap_alert_pct));
      setExpiryWarnDays(String(DEFAULT_BUSINESS_SETTINGS.expiry_warn_days));
      setToast(sa.savedToast);
    } catch (err) {
      mapError(err);
    } finally {
      setUsingRecommended(false);
    }
  }

  async function handleSave() {
    setFormError(null);
    setSaving(true);
    try {
      await authedFetch(`/businesses/${business.id}/settings/`, {
        method: 'PATCH',
        body: {
          count_deadline_hour: Number(countDeadlineHour),
          closing_count_hour: Number(closingCountHour),
          target_cost_pct: targetCostPct,
          wastage_alert_pct: wastageAlertPct,
          rate_creep_pct: rateCreepPct,
          gap_alert_pct: gapAlertPct,
          expiry_warn_days: Number(expiryWarnDays),
        },
      });
      setToast(sa.savedToast);
    } catch (err) {
      mapError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell active="settings">
      <Screen maxWidth={HOME_CONTENT_WIDTH}>
        <Heading level={1}>{sa.title}</Heading>

        {formError ? (
          <View style={styles.formError}>
            <Icon name="error" size={type.md} colour={colours.danger} />
            <Body style={styles.formErrorText}>{formError}</Body>
          </View>
        ) : null}

        {!loading ? (
          <>
            <Button
              label={sa.useRecommended}
              variant="primary"
              onPress={handleUseRecommended}
              loading={usingRecommended}
              disabled={saving}
            />

            <TextField
              label={s6.countDeadlineLabel}
              value={countDeadlineHour}
              onChangeText={setCountDeadlineHour}
              keyboardType="number-pad"
              hint={sa.openingCountMechanism(countDeadlineHour)}
            />
            <TextField
              label={sa.closingCountLabel}
              value={closingCountHour}
              onChangeText={setClosingCountHour}
              keyboardType="number-pad"
              hint={sa.closingCountMechanism(closingCountHour)}
            />
            <TextField
              label={s6.targetCostLabel}
              value={targetCostPct}
              onChangeText={setTargetCostPct}
              keyboardType="decimal-pad"
              hint={targetCostHint(business?.business_type ?? '')}
            />
            <TextField
              label={s6.wastageAlertLabel}
              value={wastageAlertPct}
              onChangeText={setWastageAlertPct}
              keyboardType="decimal-pad"
              hint={sa.wastageMechanism(wastageAlertPct)}
            />
            <TextField
              label={s6.rateRiseLabel}
              value={rateCreepPct}
              onChangeText={setRateCreepPct}
              keyboardType="decimal-pad"
              hint={sa.rateRiseMechanism(rateCreepPct)}
            />
            <TextField
              label={sa.gapAlertLabel}
              value={gapAlertPct}
              onChangeText={setGapAlertPct}
              keyboardType="decimal-pad"
              hint={sa.gapAlertMechanism(gapAlertPct)}
            />
            <TextField
              label={sa.expiryWarnDaysLabel}
              value={expiryWarnDays}
              onChangeText={setExpiryWarnDays}
              keyboardType="number-pad"
              hint={sa.expiryWarnDaysMechanism(expiryWarnDays)}
            />

            <Button
              label={sa.save}
              variant="primary"
              onPress={handleSave}
              loading={saving}
              disabled={usingRecommended}
            />
          </>
        ) : null}
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
