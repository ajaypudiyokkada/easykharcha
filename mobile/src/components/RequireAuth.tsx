import { Redirect } from 'expo-router';
import React from 'react';

import { useSession } from '../state/session';
import { Loading, Screen } from '../ui';

type Props = {
  children: React.ReactNode;
  /** True for screens reachable before a business is chosen (the picker itself, add-business, PIN
   * change). Everything else needs a tenant to have anything to show. */
  tenantless?: boolean;
  /** The Change PIN screen itself must not redirect-to-self when `must_change_pin` is set. */
  skipMustChangePin?: boolean;
};

/**
 * Guards a standalone screen — Admin, Settings, Audit, Trends, Sales Import, Recipe, Tenants,
 * Add Tenant, Change PIN. The `(app)` tab group guards its own tabs; these sit outside it in the root
 * `<Stack>` and had no guard at all, so a signed-out visitor who typed the URL got a blank screen
 * (the API still refused every request, but the client showed nothing explaining why).
 *
 * This is a leaf-level conditional `<Redirect>`, the same shape `index.tsx` and `(app)/_layout.tsx`
 * already use. It must **not** move up into the root layout: a layout's job is to render `<Stack>`
 * unconditionally so expo-router knows what routes exist, and swapping that out for `<Redirect>`
 * unmounts every registered route in the same render rather than navigating cleanly.
 */
export function RequireAuth({ children, tenantless = false, skipMustChangePin = false }: Props) {
  const { ready, user, tenant } = useSession();

  if (!ready) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (!user) return <Redirect href="/login" />;
  if (user.must_change_pin && !skipMustChangePin) return <Redirect href="/change-pin" />;
  if (!tenantless && !tenant) return <Redirect href="/tenants" />;
  return <>{children}</>;
}
