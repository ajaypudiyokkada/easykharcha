import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useAlerts, useTenantMutation, useTenantQuery } from '../../src/api/hooks';
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
  Loading,
  Notice,
  Picker,
  Screen,
  Title,
  qty,
  today,
} from '../../src/ui';

type StockRow = {
  ingredient: number;
  code: string;
  name: string;
  unit: string;
  opening_qty: string | null;
  opened_by: string | null;
  closing_qty: string | null;
  closed_by: string | null;
  suggested_opening: string;
  purchased_today: string;
  closing_ceiling: string;
};

/**
 * Daily stock capture.
 *
 * This screen shows the previous closing (to pre-fill) and today's purchases (the impossible-count
 * ceiling) and nothing else. No expected usage, no variance, no sales — a count written to match a
 * displayed target is worthless (§1b).
 */
export default function Stock() {
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState<'open' | 'close'>('open');
  const { data, isLoading, error, refetch } = useTenantQuery<{ date: string; rows: StockRow[] }>(
    `/stock?date=${date}`,
  );
  const alerts = useAlerts();

  return (
    <Screen>
      <Title>Daily stock</Title>
      <Banner alerts={alerts.data ?? []} />

      <Card>
        <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" hint="YYYY-MM-DD" />
        <Picker
          label="Recording"
          value={mode}
          options={[
            { value: 'open' as const, label: 'Opening count' },
            { value: 'close' as const, label: 'Closing count' },
          ]}
          onChange={setMode}
        />
      </Card>

      <ErrorNotice error={error} />
      {isLoading ? <Loading /> : null}

      {data?.rows.map((row) => (
        <StockCard key={row.ingredient} row={row} date={date} mode={mode} onSaved={() => refetch()} />
      ))}

      {data && data.rows.length === 0 ? (
        <Notice>No tracked ingredients yet. An Owner or Manager adds them under Admin → Ingredients.</Notice>
      ) : null}
    </Screen>
  );
}

function StockCard({
  row,
  date,
  mode,
  onSaved,
}: {
  row: StockRow;
  date: string;
  mode: 'open' | 'close';
  onSaved: () => void;
}) {
  const existing = mode === 'open' ? row.opening_qty : row.closing_qty;
  const by = mode === 'open' ? row.opened_by : row.closed_by;
  const [value, setValue] = useState('');

  const mutation = useTenantMutation<{ qty: string }>((variables) => ({
    suffix: `/stock/${mode}`,
    body: { date, ingredient: row.ingredient, qty: variables.qty },
  }));

  const hint = useMemo(() => {
    if (mode === 'open') return `Yesterday's closing: ${qty(row.suggested_opening, row.unit)}`;
    return `Most you can have: ${qty(row.closing_ceiling, row.unit)} (opening ${qty(
      row.opening_qty ?? row.suggested_opening,
      row.unit,
    )} + bought today ${qty(row.purchased_today, row.unit)})`;
  }, [mode, row]);

  if (existing !== null && existing !== undefined) {
    return (
      <Card>
        <Heading>{row.name}</Heading>
        <Body>
          {mode === 'open' ? 'Opening' : 'Closing'} recorded: {qty(existing, row.unit)}
        </Body>
        <Caption>{by ? `by ${by}` : ''} · Corrections go through an Owner.</Caption>
      </Card>
    );
  }

  return (
    <Card>
      <Heading>{row.name}</Heading>
      <Field
        label={`${mode === 'open' ? 'Opening' : 'Closing'} count (${row.unit})`}
        value={value}
        onChangeText={setValue}
        keyboardType="decimal-pad"
        placeholder="0.000"
        hint={hint}
      />
      {mutation.error ? <ErrorNotice error={mutation.error} /> : null}
      <View style={{ height: spacing.xs }} />
      <Button
        label="Save count"
        disabled={!value}
        busy={mutation.isPending}
        onPress={() =>
          mutation.mutate(
            { qty: value },
            {
              onSuccess: () => {
                setValue('');
                onSaved();
              },
            },
          )
        }
      />
    </Card>
  );
}
