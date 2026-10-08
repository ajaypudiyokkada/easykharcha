import React, { useState } from 'react';
import { View } from 'react-native';

import { useBootstrap, useTenantMutation, useTenantQuery } from '../../src/api/hooks';
import { Cap, useSession } from '../../src/state/session';
import { spacing } from '../../src/theme';
import {
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
  qty,
  today,
} from '../../src/ui';

/** The chef asks, the manager buys. Deliberately not a Manager capability to raise one (§1). */
export default function Requests() {
  const { can } = useSession();
  const bootstrap = useBootstrap();
  const list = useTenantQuery<any>('/requests/');

  const [ingredient, setIngredient] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const create = useTenantMutation(() => ({
    suffix: '/requests/',
    body: { date: today(), ingredient, qty: amount, note },
  }));
  const fulfil = useTenantMutation<{ id: number }>((variables) => ({
    suffix: `/requests/${variables.id}/fulfil/`,
    body: {},
  }));

  const ingredients = bootstrap.data?.ingredients ?? [];
  const rows = list.data?.results ?? list.data ?? [];
  const open = rows.filter((row: any) => row.status === 'open');
  const closed = rows.filter((row: any) => row.status !== 'open');

  return (
    <Screen>
      <Title>Inventory requests</Title>

      {can(Cap.REQUEST_RAISE) ? (
        <Card>
          <Heading>Ask for stock</Heading>
          <Picker
            label="Ingredient"
            value={ingredient}
            options={ingredients.map((row: any) => ({ value: row.id as number, label: row.name }))}
            onChange={setIngredient}
          />
          <Field label="Quantity" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. needed by Friday" />
          <ErrorNotice error={create.error} />
          <View style={{ height: spacing.xs }} />
          <Button
            label="Raise request"
            busy={create.isPending}
            disabled={!ingredient || !amount}
            onPress={() =>
              create.mutate(undefined as never, {
                onSuccess: () => {
                  setAmount('');
                  setNote('');
                },
              })
            }
          />
        </Card>
      ) : (
        <Notice>
          Raising a request is a Head Chef or Owner action. You can fulfil the open ones below by
          recording the purchase against them.
        </Notice>
      )}

      <Card>
        <Heading>Open ({open.length})</Heading>
        {open.length === 0 ? (
          <Caption>Nothing waiting.</Caption>
        ) : (
          open.map((row: any) => (
            <Row
              key={row.id}
              left={
                <>
                  <Body>
                    {row.ingredient_name} — {qty(row.qty, row.unit)}
                  </Body>
                  <Caption>
                    {row.date}
                    {row.requested_by_name ? ` · ${row.requested_by_name}` : ''}
                    {row.note ? ` · ${row.note}` : ''}
                  </Caption>
                </>
              }
              right={
                can(Cap.REQUEST_FULFIL) ? (
                  <Button
                    label="Mark done"
                    variant="secondary"
                    busy={fulfil.isPending}
                    onPress={() => fulfil.mutate({ id: row.id })}
                  />
                ) : undefined
              }
            />
          ))
        )}
        <ErrorNotice error={fulfil.error} />
      </Card>

      {closed.length ? (
        <Card>
          <Heading>Fulfilled</Heading>
          {closed.slice(0, 20).map((row: any) => (
            <Row
              key={row.id}
              left={
                <>
                  <Body muted>
                    {row.ingredient_name} — {qty(row.qty, row.unit)}
                  </Body>
                  <Caption>
                    {row.date}
                    {row.fulfilled_purchase ? ' · closed by a recorded purchase' : ' · closed manually'}
                  </Caption>
                </>
              }
            />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
