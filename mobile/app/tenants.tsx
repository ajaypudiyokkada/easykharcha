import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { RequireAuth } from '../src/components/RequireAuth';
import { Cap, useSession } from '../src/state/session';
import { radius, spacing } from '../src/theme';
import { Body, Button, Caption, Card, Heading, Screen, Title, usePalette } from '../src/ui';

const ROLE_LABELS: Record<string, string> = {
  staff: 'Staff',
  head_chef: 'Head Chef',
  manager: 'Manager',
  owner: 'Owner',
  super_admin: 'Super Admin',
};

export default function Tenants() {
  return (
    <RequireAuth tenantless>
      <TenantsScreen />
    </RequireAuth>
  );
}

function TenantsScreen() {
  const palette = usePalette();
  const { tenants, selectTenant, signOut, isSuperAdmin, user, can } = useSession();

  const choose = async (id: number) => {
    await selectTenant(id);
    router.replace('/(app)/home');
  };

  return (
    <Screen>
      <Title>Choose a business</Title>
      <Caption>
        Signed in as {user?.name || user?.phone}
        {isSuperAdmin ? ' · Super Admin' : ''}
      </Caption>

      {tenants.length === 0 ? (
        <Card>
          <Heading>No businesses yet</Heading>
          <Body muted>
            {isSuperAdmin
              ? 'Add the first business to get started.'
              : 'Your account has no access yet. Ask the owner to add you.'}
          </Body>
        </Card>
      ) : null}

      {tenants.map((tenant) => (
        <Pressable
          key={tenant.id}
          onPress={() => choose(tenant.id)}
          style={({ pressed }) => ({
            backgroundColor: palette.surface,
            borderRadius: radius.lg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border,
            padding: spacing.lg,
            opacity: pressed ? 0.85 : 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
          })}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.md,
              backgroundColor: tenant.primary_colour,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Body>{tenant.name.slice(0, 2).toUpperCase()}</Body>
          </View>
          <View style={{ flex: 1 }}>
            <Heading>{tenant.name}</Heading>
            <Caption>
              {ROLE_LABELS[tenant.role ?? ''] ?? tenant.role} · {tenant.business_type_label}
            </Caption>
          </View>
        </Pressable>
      ))}

      {isSuperAdmin || can(Cap.TENANT_CREATE) ? (
        <Button label="Add a business" variant="secondary" onPress={() => router.push('/add-tenant')} />
      ) : null}
      {/* No explicit navigation: RequireAuth already redirects to /login the instant `user` goes
          null — see app/(app)/more.tsx for why adding one here would race it. */}
      <Button label="Sign out" variant="ghost" onPress={() => signOut()} />
    </Screen>
  );
}
