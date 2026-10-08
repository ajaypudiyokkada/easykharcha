import { router } from 'expo-router';
import React from 'react';

import { Cap, useSession } from '../../src/state/session';
import { Body, Button, Caption, Card, Heading, Row, Screen, Title } from '../../src/ui';

export default function More() {
  const { tenant, tenants, user, can, signOut, isSuperAdmin } = useSession();

  const links = [
    { label: 'Admin — ingredients, menu, vendors, staff', href: '/admin', show: can(Cap.CONFIG_ADD) },
    { label: 'Trends — cost % week by week', href: '/trends', show: can(Cap.REPORTS_VIEW) },
    { label: 'Audit log', href: '/audit', show: can(Cap.AUDIT_VIEW) },
    { label: 'Import sales from POS', href: '/sales-import', show: can(Cap.SALES_RECORD) },
    { label: 'Business settings', href: '/settings', show: can(Cap.TENANT_SETTINGS) },
    { label: 'Add a business', href: '/add-tenant', show: can(Cap.TENANT_CREATE) },
    { label: 'Change my PIN', href: '/change-pin', show: true },
  ].filter((link) => link.show);

  return (
    <Screen>
      <Title>More</Title>
      <Card>
        <Heading>{tenant?.name}</Heading>
        <Caption>
          Signed in as {user?.name || user?.phone} · {tenant?.role}
          {isSuperAdmin ? ' · Super Admin' : ''}
        </Caption>
      </Card>

      <Card>
        {links.map((link) => (
          <Row
            key={link.href}
            onPress={() => router.push(link.href as never)}
            left={<Body>{link.label}</Body>}
            right={<Caption>›</Caption>}
          />
        ))}
      </Card>

      {tenants.length > 1 || isSuperAdmin ? (
        <Button label="Switch business" variant="secondary" onPress={() => router.push('/tenants')} />
      ) : null}
      <Button label="Sign out" variant="ghost" onPress={() => signOut().then(() => router.replace('/login'))} />
      <Caption>Powered by EasyKharcha</Caption>
    </Screen>
  );
}
