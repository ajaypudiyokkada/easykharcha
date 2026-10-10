import { router } from 'expo-router';
import React from 'react';

import { Cap, useSession } from '../../src/state/session';
import { Body, Button, Caption, Card, Heading, Row, Screen, Title } from '../../src/ui';

/**
 * Everything the role can reach that is not in its five tabs, plus the admin and account screens.
 *
 * The tab bar carries the daily work; this carries the rest. Nothing is reachable here that the role
 * could not reach by typing the URL — the server decides, this only decides what is worth showing.
 */
export default function More() {
  const { tenant, tenants, user, can, signOut, isSuperAdmin } = useSession();

  const entry = [
    { label: 'Daily stock', href: '/(app)/stock', show: can(Cap.STOCK_CAPTURE) },
    { label: 'Wastage', href: '/(app)/wastage', show: can(Cap.WASTAGE_ADD) },
    { label: 'Receive goods', href: '/(app)/receive', show: can(Cap.RECEIVE_GOODS) },
    {
      label: 'Inventory requests',
      href: '/(app)/requests',
      show: can(Cap.REQUEST_RAISE) || can(Cap.REQUEST_FULFIL),
    },
    { label: 'Sales', href: '/(app)/sales', show: can(Cap.SALES_RECORD) },
    { label: 'Import sales from POS', href: '/sales-import', show: can(Cap.SALES_RECORD) },
  ].filter((link) => link.show);

  const manage = [
    { label: 'Report', href: '/(app)/report', show: can(Cap.REPORTS_VIEW) },
    { label: 'Trends — cost % week by week', href: '/trends', show: can(Cap.REPORTS_VIEW) },
    { label: 'Admin — ingredients, menu, vendors, staff', href: '/admin', show: can(Cap.CONFIG_ADD) },
    { label: 'Audit log', href: '/audit', show: can(Cap.AUDIT_VIEW) },
    { label: 'Business settings', href: '/settings', show: can(Cap.TENANT_SETTINGS) },
    { label: 'Add a business', href: '/add-tenant', show: can(Cap.TENANT_CREATE) },
  ].filter((link) => link.show);

  const account = [{ label: 'Change my PIN', href: '/change-pin', show: true }];

  const section = (heading: string, links: { label: string; href: string }[]) =>
    links.length ? (
      <Card>
        <Heading>{heading}</Heading>
        {links.map((link) => (
          <Row
            key={link.href}
            onPress={() => router.push(link.href as never)}
            left={<Body>{link.label}</Body>}
            right={<Caption>›</Caption>}
          />
        ))}
      </Card>
    ) : null;

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

      {section('Record', entry)}
      {section('Manage', manage)}
      {section('Account', account)}

      {tenants.length > 1 || isSuperAdmin ? (
        <Button label="Switch business" variant="secondary" onPress={() => router.push('/tenants')} />
      ) : null}
      {/* No explicit navigation here: (app)/_layout.tsx already returns <Redirect href="/login" />
          the instant `user` goes null. Calling router.replace('/login') as well raced that reactive
          redirect — two navigations to the same route forced a remount of the login screen mid-type,
          wiping out whatever the next person typed into it. */}
      <Button label="Sign out" variant="ghost" onPress={() => signOut()} />
      <Caption>Powered by EasyKharcha</Caption>
    </Screen>
  );
}
