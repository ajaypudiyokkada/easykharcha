import React, { useEffect, useState } from 'react';

import { useTenantMutation, useTenantQuery } from '../src/api/hooks';
import { RequireAuth } from '../src/components/RequireAuth';
import { useSession } from '../src/state/session';
import { Button, Caption, Card, ErrorNotice, Field, Heading, Loading, Picker, Screen, Title } from '../src/ui';

export default function Settings() {
  return (
    <RequireAuth>
      <SettingsScreen />
    </RequireAuth>
  );
}

function SettingsScreen() {
  const { refreshSession } = useSession();
  const { data, isLoading, error } = useTenantQuery<any>('/settings');
  const [form, setForm] = useState<any>(null);

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  const save = useTenantMutation(() => ({ suffix: '/settings', method: 'PATCH' as const, body: form }));

  if (isLoading || !form) return <Screen><Loading /></Screen>;

  const set = (key: string) => (value: string) => setForm({ ...form, [key]: value });

  return (
    <Screen>
      <Title>Business settings</Title>
      <ErrorNotice error={error} />

      <Card>
        <Heading>Identity</Heading>
        <Field label="Name" value={String(form.name ?? '')} onChangeText={set('name')} />
        <Field label="Tagline" value={String(form.tagline ?? '')} onChangeText={set('tagline')} />
        <Picker
          label="Business type"
          value={form.business_type}
          options={[
            { value: 'restaurant', label: 'Restaurant' },
            { value: 'homestay', label: 'Homestay' },
            { value: 'cloud_kitchen', label: 'Cloud kitchen' },
            { value: 'bakery', label: 'Bakery' },
            { value: 'other', label: 'Other' },
          ]}
          onChange={(business_type) => setForm({ ...form, business_type })}
        />
        <Caption>Business type changes the words in the app only. The arithmetic is identical.</Caption>
      </Card>

      <Card>
        <Heading>Branding</Heading>
        <Field label="Primary colour" value={String(form.primary_colour ?? '')} onChangeText={set('primary_colour')} hint="Hex, e.g. #B19461" />
        <Field label="Accent colour" value={String(form.accent_colour ?? '')} onChangeText={set('accent_colour')} hint="Hex, e.g. #8EABC1" />
      </Card>

      <Card>
        <Heading>Thresholds</Heading>
        <Field label="Target food cost %" value={String(form.default_target_pct ?? '')} onChangeText={set('default_target_pct')} keyboardType="decimal-pad" />
        <Field
          label="Wastage alert %"
          value={String(form.waste_alert_pct ?? '')}
          onChangeText={set('waste_alert_pct')}
          keyboardType="decimal-pad"
          hint="Of (opening + purchased)."
        />
        <Field
          label="Rate creep %"
          value={String(form.rate_creep_pct ?? '')}
          onChangeText={set('rate_creep_pct')}
          keyboardType="decimal-pad"
          hint="Alert when a purchase rate exceeds the standard rate by this much."
        />
        <Field
          label="Variance alert %"
          value={String(form.variance_alert_pct ?? '')}
          onChangeText={set('variance_alert_pct')}
          keyboardType="decimal-pad"
          hint="Only fires at 100% recipe coverage — a half-configured ingredient never alerts."
        />
        <Field
          label="SLA hours"
          value={String(form.sla_hours ?? '')}
          onChangeText={set('sla_hours')}
          keyboardType="number-pad"
          hint="Hours after midnight by which yesterday's closing must be in. Opening uses half this."
        />
      </Card>

      <Card>
        <Heading>Trading day</Heading>
        <Field
          label="Business day cutoff hour"
          value={String(form.business_day_cutoff_hour ?? '')}
          onChangeText={set('business_day_cutoff_hour')}
          keyboardType="number-pad"
          hint="Orders before this hour count toward the previous night, so a 1 a.m. order lands on the day its stock was counted."
        />
        <Field
          label="Time zone"
          value={String(form.timezone ?? '')}
          onChangeText={set('timezone')}
          hint="POS timestamps carry no offset, so imports read them in this zone. e.g. Asia/Kolkata"
        />
      </Card>

      <ErrorNotice error={save.error} />
      <Button
        label="Save settings"
        busy={save.isPending}
        onPress={() => save.mutate(undefined as never, { onSuccess: () => refreshSession() })}
      />
    </Screen>
  );
}
