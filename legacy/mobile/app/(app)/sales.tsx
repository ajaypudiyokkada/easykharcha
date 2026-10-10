import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { useAlerts, useBootstrap, useTenantMutation, useTenantQuery } from '../../src/api/hooks';
import { Cap, useSession } from '../../src/state/session';
import { spacing } from '../../src/theme';
import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  ErrorNotice,
  Field,
  Heading,
  Notice,
  Picker,
  Row,
  Screen,
  Title,
  money,
  today,
} from '../../src/ui';
import { EditDelete } from './wastage';

export default function Sales() {
  const { can } = useSession();
  const bootstrap = useBootstrap();
  const alerts = useAlerts();
  const recent = useTenantQuery<any>('/recent?days=7');

  const [date, setDate] = useState(today());
  const [dish, setDish] = useState<number | null>(null);
  const [plates, setPlates] = useState('');
  const [revenue, setRevenue] = useState('');

  const create = useTenantMutation(() => ({
    suffix: '/sales/',
    body: { date, dish, plates: Number(plates), ...(revenue ? { revenue } : {}) },
  }));

  const dishes = (bootstrap.data?.dishes ?? []).filter((row: any) => row.active);
  const selected = dishes.find((row: any) => row.id === dish);
  const computed = selected && plates ? Number(selected.price) * Number(plates) : null;

  return (
    <Screen>
      <Title>Sales</Title>
      <Banner alerts={alerts.data ?? []} />

      <Card>
        <Heading>Record a day&apos;s plates</Heading>
        <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
        <Picker
          label="Menu item"
          value={dish}
          options={dishes.map((row: any) => ({ value: row.id as number, label: row.name }))}
          onChange={setDish}
          emptyLabel="No menu items yet."
        />
        <Field label="Plates sold" value={plates} onChangeText={setPlates} keyboardType="number-pad" />
        <Field
          label="Revenue (optional)"
          value={revenue}
          onChangeText={setRevenue}
          keyboardType="decimal-pad"
          hint={
            computed !== null
              ? `Leave blank for ${money(computed)} (${money(selected?.price)} × ${plates}). Override it for a discount.`
              : 'Leave blank to use menu price × plates.'
          }
        />
        <ErrorNotice error={create.error} />
        <View style={{ height: spacing.xs }} />
        <Button
          label="Save sales"
          busy={create.isPending}
          disabled={!dish || !plates}
          onPress={() =>
            create.mutate(undefined as never, {
              onSuccess: () => {
                setPlates('');
                setRevenue('');
              },
            })
          }
        />
      </Card>

      <Button label="Import from POS report" variant="secondary" onPress={() => router.push('/sales-import')} />

      {selected && Number(selected.price) === 0 ? (
        <Notice tone="warning">
          {selected.name} has a ₹0 price, so every cost % that uses it will read as unusable. Set the real
          price under Admin → Menu items first.
        </Notice>
      ) : null}

      <Card>
        <Heading>Last 7 days</Heading>
        {!recent.data?.sales?.length ? (
          <Caption>Nothing recorded yet.</Caption>
        ) : (
          recent.data.sales.map((entry: any) => (
            <Row
              key={entry.id}
              left={
                <>
                  <Body>
                    {entry.dish_name} — {entry.plates} plates
                  </Body>
                  <Caption>
                    {entry.date} · {money(entry.revenue)} · {entry.source === 'import' ? 'imported' : 'manual'}
                    {entry.entered_by_name ? ` · ${entry.entered_by_name}` : ''}
                  </Caption>
                </>
              }
              right={can(Cap.ENTRY_EDIT) ? <EditDelete table="sale" id={entry.id} /> : undefined}
            />
          ))
        )}
      </Card>
    </Screen>
  );
}
