import { router } from 'expo-router';
import React, { useState } from 'react';

import { post } from '../src/api/client';
import { RequireAuth } from '../src/components/RequireAuth';
import { useSession } from '../src/state/session';
import { Button, Caption, Card, ErrorNotice, Field, Heading, Picker, Screen, Title } from '../src/ui';

export default function AddTenant() {
  return (
    <RequireAuth tenantless>
      <AddTenantScreen />
    </RequireAuth>
  );
}

function AddTenantScreen() {
  const { refreshSession, selectTenant } = useSession();
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [type, setType] = useState('restaurant');
  const [seed, setSeed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const created = await post('/tenants', {
        name,
        tagline,
        business_type: type,
        seed_from_fomo: seed,
      });
      await refreshSession();
      await selectTenant(created.id);
      router.replace('/(app)/home');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Add a business</Title>
      <Card>
        <Field label="Name" value={name} onChangeText={setName} autoFocus />
        <Field label="Tagline" value={tagline} onChangeText={setTagline} placeholder="optional" />
        <Picker
          label="Type"
          value={type}
          options={[
            { value: 'restaurant', label: 'Restaurant' },
            { value: 'homestay', label: 'Homestay' },
            { value: 'cloud_kitchen', label: 'Cloud kitchen' },
            { value: 'bakery', label: 'Bakery' },
            { value: 'other', label: 'Other' },
          ]}
          onChange={setType}
        />
        <Picker
          label="Starting data"
          value={seed ? 'seed' : 'blank'}
          options={[
            { value: 'blank', label: 'Start empty' },
            { value: 'seed', label: "Pre-fill from FOMO's catalogue" },
          ]}
          onChange={(value) => setSeed(value === 'seed')}
        />
        {seed ? (
          <Caption>
            Copies vendors, ingredients and menu item names. Prices are not copied — another
            restaurant&apos;s prices are not yours, and a plausible wrong price corrupts every cost %.
          </Caption>
        ) : null}
        <ErrorNotice error={error} />
        <Button label="Create business" busy={busy} disabled={!name} onPress={submit} />
      </Card>
      <Caption>You become the Owner of whatever you create.</Caption>
    </Screen>
  );
}
