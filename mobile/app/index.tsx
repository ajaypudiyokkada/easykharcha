import { Redirect } from 'expo-router';
import React from 'react';

import { useSession } from '../src/state/session';
import { Loading, Screen } from '../src/ui';

export default function Index() {
  const { ready, user, tenant, tenants } = useSession();

  if (!ready) {
    return (
      <Screen>
        <Loading label="Starting EasyKharcha…" />
      </Screen>
    );
  }
  if (!user) return <Redirect href="/login" />;
  if (user.must_change_pin) return <Redirect href="/change-pin" />;
  // One business goes straight in; more than one (or a Super Admin) sees the picker (§2).
  if (!tenant) return <Redirect href={tenants.length ? '/tenants' : '/tenants'} />;
  return <Redirect href="/(app)/home" />;
}
