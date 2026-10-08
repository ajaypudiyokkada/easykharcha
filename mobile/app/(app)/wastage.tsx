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
  qty,
  today,
} from '../../src/ui';

const REASONS = [
  { value: 'spoilage', label: 'Spoilage' },
  { value: 'trim', label: 'Trim/prep loss' },
  { value: 'staff_meal', label: 'Staff meal' },
  { value: 'spill', label: 'Spill/damage' },
  { value: 'returned', label: 'Returned/rejected' },
  { value: 'other', label: 'Other' },
];

export default function Wastage() {
  const { can } = useSession();
  const bootstrap = useBootstrap();
  const alerts = useAlerts();
  const recent = useTenantQuery<any>('/recent?days=7');

  const [date, setDate] = useState(today());
  const [ingredient, setIngredient] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<string>('spoilage');
  const [note, setNote] = useState('');

  const mutation = useTenantMutation(() => ({
    suffix: '/wastage/',
    body: { date, ingredient, qty: amount, reason, note },
  }));

  const ingredients = bootstrap.data?.ingredients ?? [];
  const selected = ingredients.find((row: any) => row.id === ingredient);

  const reset = () => {
    setAmount('');
    setNote('');
  };

  return (
    <Screen>
      <Title>Wastage</Title>
      <Banner alerts={alerts.data ?? []} />

      <Card>
        <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
        <Picker
          label="Ingredient"
          value={ingredient}
          options={ingredients.map((row: any) => ({ value: row.id as number, label: row.name }))}
          onChange={setIngredient}
          emptyLabel="No ingredients yet."
        />
        <Field
          label={`Quantity${selected ? ` (${selected.unit})` : ''}`}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.000"
        />
        <Picker label="Reason" value={reason} options={REASONS} onChange={setReason} />
        {reason === 'other' ? (
          <Field
            label="What happened?"
            value={note}
            onChangeText={setNote}
            placeholder="e.g. power cut overnight"
            hint="Required for Other — otherwise the report cannot tell you where waste comes from."
            multiline
          />
        ) : (
          <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="" />
        )}
        <ErrorNotice error={mutation.error} />
        <View style={{ height: spacing.xs }} />
        <Button
          label="Record wastage"
          busy={mutation.isPending}
          disabled={!ingredient || !amount || (reason === 'other' && !note.trim())}
          onPress={() => mutation.mutate(undefined as never, { onSuccess: reset })}
        />
      </Card>

      <Card>
        <Heading>Last 7 days</Heading>
        {!recent.data?.wastage?.length ? (
          <Caption>Nothing recorded yet.</Caption>
        ) : (
          recent.data.wastage.map((entry: any) => (
            <Row
              key={entry.id}
              left={
                <>
                  <Body>
                    {entry.ingredient_name} — {qty(entry.qty, entry.unit)}
                  </Body>
                  <Caption>
                    {entry.date} · {entry.reason_label}
                    {entry.note ? ` · ${entry.note}` : ''}
                    {entry.entered_by_name ? ` · ${entry.entered_by_name}` : ''}
                  </Caption>
                </>
              }
              right={can(Cap.ENTRY_EDIT) ? <EditDelete table="wastage" id={entry.id} /> : undefined}
            />
          ))
        )}
      </Card>

      {!can(Cap.ENTRY_EDIT) ? (
        <Notice>
          Entries are append-only for your role. If something is wrong, ask an Owner to correct it — the
          change is recorded in the audit log.
        </Notice>
      ) : null}
    </Screen>
  );
}

export function EditDelete({ table, id }: { table: string; id: number }) {
  const mutation = useTenantMutation(() => ({ suffix: `/entries/${table}/${id}`, method: 'DELETE' as const }));
  return (
    <Button label="Delete" variant="ghost" busy={mutation.isPending} onPress={() => mutation.mutate(undefined as never)} />
  );
}
