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
  wastage_today: string;
};

const UNITS = [
  { value: 'kg', label: 'kg' },
  { value: 'l', label: 'litre' },
  { value: 'pc', label: 'piece' },
  { value: 'pkt', label: 'packet' },
];

const WASTAGE_REASONS = [
  { value: 'spoilage', label: 'Spoilage' },
  { value: 'trim', label: 'Trim/prep loss' },
  { value: 'staff_meal', label: 'Staff meal' },
  { value: 'spill', label: 'Spill/damage' },
  { value: 'returned', label: 'Returned/rejected' },
  { value: 'other', label: 'Other' },
];

/**
 * Daily stock ledger.
 *
 * One card per tracked ingredient, three sections each: opening, closing, wastage — the three things
 * anyone with a clipboard physically observes. No expected usage, no variance, no sales anywhere on
 * this screen (§1b) — reflecting an ingredient's *own* logged wastage back is fine (it's what the same
 * person just typed), but nothing here is computed from a sale.
 *
 * Owner/Manager/SA additionally get a quick "add an item" form at the top, so a new ingredient can be
 * started without leaving this screen for Admin.
 */
export default function Stock() {
  const [date, setDate] = useState(today());
  const { data, isLoading, error, refetch } = useTenantQuery<{
    date: string;
    rows: StockRow[];
    can_add_ingredient: boolean;
  }>(`/stock?date=${date}`);
  const alerts = useAlerts();

  return (
    <Screen>
      <Title>Daily stock</Title>
      <Caption>One ledger per ingredient — opening, closing and wastage all live here.</Caption>
      <Banner alerts={alerts.data ?? []} />

      <Card>
        <Field
          label="Date"
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
          hint="YYYY-MM-DD"
        />
      </Card>

      {data?.can_add_ingredient ? <AddIngredient onAdded={() => refetch()} /> : null}

      <ErrorNotice error={error} />
      {isLoading ? <Loading /> : null}

      {data?.rows.map((row) => (
        <LedgerCard key={row.ingredient} row={row} date={date} onSaved={() => refetch()} />
      ))}

      {data && data.rows.length === 0 ? (
        data.can_add_ingredient ? (
          <Notice>Nothing to count yet — add the first ingredient above.</Notice>
        ) : (
          <Notice>No tracked ingredients yet. Ask an Owner or Manager to add them.</Notice>
        )
      ) : null}
    </Screen>
  );
}

function AddIngredient({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('kg');
  const [rate, setRate] = useState('');

  const create = useTenantMutation(() => ({
    suffix: '/ingredients/',
    body: {
      code,
      name,
      unit,
      rate: rate || '0',
      // Sensible defaults for a quick add. Yield %, shared/misc and the canonical tag are config a
      // recipe needs, not what's needed to start counting stock — those stay in Admin.
      recipe_unit: unit === 'pc' || unit === 'pkt' ? 'pc' : unit === 'l' ? 'ml' : 'g',
      recipe_units_per_stock_unit: unit === 'kg' || unit === 'l' ? '1000' : '1',
      yield_pct: '100',
    },
  }));

  const reset = () => {
    setOpen(false);
    setCode('');
    setName('');
    setRate('');
  };

  if (!open) {
    return (
      <Button label="+ Add an item to the stock list" variant="secondary" onPress={() => setOpen(true)} />
    );
  }

  return (
    <Card>
      <Heading>Add an item</Heading>
      <Field label="Code" value={code} onChangeText={setCode} placeholder="CHK-BNL" />
      <Field label="Name" value={name} onChangeText={setName} placeholder="Chicken boneless" />
      <Picker label="Unit" value={unit} options={UNITS} onChange={setUnit} />
      <Field
        label="Standard rate per unit (optional)"
        value={rate}
        onChangeText={setRate}
        keyboardType="decimal-pad"
        hint="Used when there's no purchase yet to weight the cost against."
      />
      <ErrorNotice error={create.error} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Add"
            busy={create.isPending}
            disabled={!code || !name}
            onPress={() => create.mutate(undefined as never, { onSuccess: () => { reset(); onAdded(); } })}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Cancel" variant="ghost" onPress={reset} />
        </View>
      </View>
      <Caption>
        Recipe yield, shared/misc, and the canonical tag are under More → Admin → Ingredients.
      </Caption>
    </Card>
  );
}

function LedgerCard({ row, date, onSaved }: { row: StockRow; date: string; onSaved: () => void }) {
  return (
    <Card>
      <Heading>{row.name}</Heading>
      <CaptureSection mode="open" row={row} date={date} onSaved={onSaved} />
      <View style={{ height: spacing.md }} />
      <CaptureSection mode="close" row={row} date={date} onSaved={onSaved} />
      <View style={{ height: spacing.md }} />
      <WastageSection row={row} date={date} onSaved={onSaved} />
    </Card>
  );
}

function CaptureSection({
  mode,
  row,
  date,
  onSaved,
}: {
  mode: 'open' | 'close';
  row: StockRow;
  date: string;
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
      <View style={{ gap: 2 }}>
        <Caption>{mode === 'open' ? 'Opening' : 'Closing'}</Caption>
        <Body>{qty(existing, row.unit)}</Body>
        <Caption>{by ? `by ${by}` : ''} · Corrections go through an Owner.</Caption>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.xs }}>
      <Field
        label={`${mode === 'open' ? 'Opening' : 'Closing'} count (${row.unit})`}
        value={value}
        onChangeText={setValue}
        keyboardType="decimal-pad"
        placeholder="0.000"
        hint={hint}
      />
      {mutation.error ? <ErrorNotice error={mutation.error} /> : null}
      <Button
        label={`Save ${mode === 'open' ? 'opening' : 'closing'}`}
        disabled={!value}
        busy={mutation.isPending}
        onPress={() =>
          mutation.mutate(
            { qty: value },
            { onSuccess: () => { setValue(''); onSaved(); } },
          )
        }
      />
    </View>
  );
}

function WastageSection({ row, date, onSaved }: { row: StockRow; date: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('spoilage');
  const [note, setNote] = useState('');

  // Wastage is not once-per-day like opening/closing — several spills can happen in one shift — so
  // this stays a running total with an always-available "add another" action, never a locked state.
  const create = useTenantMutation(() => ({
    suffix: '/wastage/',
    body: { date, ingredient: row.ingredient, qty: amount, reason, note },
  }));

  const reset = () => {
    setAmount('');
    setNote('');
    setOpen(false);
  };

  return (
    <View style={{ gap: spacing.xs }}>
      <Caption>Wastage today</Caption>
      <Body>{qty(row.wastage_today, row.unit)}</Body>

      {!open ? (
        <Button label="+ Add wastage" variant="secondary" onPress={() => setOpen(true)} />
      ) : (
        <>
          <Field
            label={`Quantity (${row.unit})`}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.000"
          />
          <Picker label="Reason" value={reason} options={WASTAGE_REASONS} onChange={setReason} />
          {reason === 'other' ? (
            <Field
              label="What happened?"
              value={note}
              onChangeText={setNote}
              placeholder="e.g. power cut overnight"
              hint="Required for Other — otherwise the report cannot tell you where waste comes from."
            />
          ) : null}
          {create.error ? <ErrorNotice error={create.error} /> : null}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                label="Save wastage"
                busy={create.isPending}
                disabled={!amount || (reason === 'other' && !note.trim())}
                onPress={() =>
                  create.mutate(undefined as never, { onSuccess: () => { reset(); onSaved(); } })
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="ghost" onPress={reset} />
            </View>
          </View>
        </>
      )}
    </View>
  );
}
