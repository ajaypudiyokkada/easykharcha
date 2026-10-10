import React, { useState } from 'react';
import { Linking, Platform, View } from 'react-native';

import { useTenantQuery } from '../../src/api/hooks';
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
  Stat,
  Table,
  Title,
  money,
  pct,
  qty,
  usePalette,
} from '../../src/ui';

function weekStart(offset = 0) {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) - offset * 7);
  return monday.toISOString().slice(0, 10);
}

export default function Report() {
  const palette = usePalette();
  const [start, setStart] = useState(weekStart());
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState<'ingredients' | 'dishes' | 'variance' | 'wastage'>('ingredients');

  const report = useTenantQuery<any>(`/report?start=${start}&end=${end}`);
  const variance = useTenantQuery<any>(`/variance?start=${start}&end=${end}`);

  const share = () => {
    const text = report.data?.share_text ?? '';
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    if (Platform.OS === 'web') window.open(url, '_blank');
    else Linking.openURL(url);
  };

  return (
    <Screen>
      <Title>Report</Title>

      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field label="From" value={start} onChangeText={setStart} placeholder="YYYY-MM-DD" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="To" value={end} onChangeText={setEnd} placeholder="YYYY-MM-DD" />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label="This week" variant="secondary" onPress={() => { setStart(weekStart()); setEnd(new Date().toISOString().slice(0, 10)); }} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Last week"
              variant="secondary"
              onPress={() => {
                const s = weekStart(1);
                const e = new Date(s);
                e.setDate(e.getDate() + 6);
                setStart(s);
                setEnd(e.toISOString().slice(0, 10));
              }}
            />
          </View>
        </View>
      </Card>

      <ErrorNotice error={report.error} />
      {report.isLoading ? <Loading /> : null}

      {report.data ? (
        <>
          <Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
              <Stat label="Revenue" value={money(report.data.totals.revenue)} />
              <Stat label="Food cost" value={money(report.data.totals.cost)} />
              <Stat
                label={`Cost % (target ${pct(report.data.totals.target_pct)})`}
                value={pct(report.data.totals.cost_pct)}
                tone={
                  report.data.totals.cost_pct !== null &&
                  Number(report.data.totals.cost_pct) > Number(report.data.totals.target_pct)
                    ? 'danger'
                    : 'success'
                }
              />
              <Stat label="Misc pool" value={money(report.data.totals.shared_pool)} />
              <Stat label="Plates" value={String(report.data.totals.plates)} />
              <Stat label="Efficiency" value={pct(variance.data?.kitchen_efficiency_pct)} />
            </View>
            {report.data.totals.complete ? null : (
              <Notice tone="warning">
                Counts are missing for {report.data.totals.ingredients_missing_counts.join(', ')}. This
                total covers {report.data.totals.ingredients_costed} of{' '}
                {report.data.totals.ingredients_total} ingredients, so the real food cost is higher than
                shown.
              </Notice>
            )}
            <Button label="Share summary to WhatsApp" variant="secondary" onPress={share} />
          </Card>

          <Banner alerts={report.data.alerts ?? []} />

          {report.data.segregation_flags?.length ? (
            <Notice tone="warning">
              {report.data.segregation_flags.map((flag: any) => flag.message).join(' ')}
            </Notice>
          ) : null}

          <Picker
            label="Show"
            value={tab}
            options={[
              { value: 'ingredients' as const, label: 'Ingredients' },
              { value: 'dishes' as const, label: 'Menu items' },
              { value: 'variance' as const, label: 'Variance' },
              { value: 'wastage' as const, label: 'Wastage' },
            ]}
            onChange={setTab}
          />

          {tab === 'ingredients' ? (
            <Card>
              <Heading>Per ingredient</Heading>
              <Table
                columns={[
                  { key: 'name', label: 'Ingredient', width: 150 },
                  { key: 'opening', label: 'Open', align: 'right', width: 80 },
                  { key: 'purchased', label: 'Bought', align: 'right', width: 80 },
                  { key: 'closing', label: 'Close', align: 'right', width: 80 },
                  { key: 'wastage', label: 'Waste', align: 'right', width: 80 },
                  { key: 'consumed', label: 'Used', align: 'right', width: 80 },
                  { key: 'rate', label: 'Rate', align: 'right', width: 90 },
                  { key: 'cost', label: 'Cost', align: 'right', width: 100 },
                  { key: 'costPct', label: 'Cost %', align: 'right', width: 90 },
                ]}
                rows={report.data.ingredients.map((row: any) => ({
                  name: row.shared ? `${row.name} (misc)` : row.name,
                  opening: qty(row.opening),
                  purchased: qty(row.purchased),
                  closing: qty(row.closing),
                  wastage: qty(row.wastage),
                  consumed: qty(row.consumed),
                  rate: money(row.weighted_rate),
                  cost: money(row.cost),
                  costPct: (
                    <Body>
                      <Caption tone={row.cost_pct !== null && Number(row.cost_pct) > Number(row.target_pct) ? 'danger' : 'textMuted'}>
                        {pct(row.cost_pct)}
                      </Caption>
                    </Body>
                  ),
                }))}
              />
              <Caption>
                A blank &quot;Used&quot; means a count is missing for that ingredient — unknown, not zero.
              </Caption>
            </Card>
          ) : null}

          {tab === 'dishes' ? (
            <Card>
              <Heading>Per menu item</Heading>
              <Table
                columns={[
                  { key: 'name', label: 'Item', width: 160 },
                  { key: 'plates', label: 'Plates', align: 'right', width: 70 },
                  { key: 'revenue', label: 'Revenue', align: 'right', width: 100 },
                  { key: 'primary', label: 'Primary', align: 'right', width: 90 },
                  { key: 'misc', label: 'Misc', align: 'right', width: 80 },
                  { key: 'estPct', label: 'Actual %', align: 'right', width: 90 },
                  { key: 'stdPct', label: 'Standard %', align: 'right', width: 100 },
                ]}
                rows={report.data.dishes.map((row: any) => ({
                  name: row.name,
                  plates: String(row.plates),
                  revenue: money(row.revenue),
                  primary: money(row.primary_cost),
                  misc: money(row.misc_cost),
                  estPct: pct(row.est_cost_pct),
                  stdPct: row.has_recipe ? pct(row.standard_cost_pct) : '—',
                }))}
              />
              <Caption>
                Standard % comes from the recipe, actual % from stock movement. The gap between them is
                kitchen efficiency.
              </Caption>
            </Card>
          ) : null}

          {tab === 'variance' ? <VarianceTable variance={variance} /> : null}

          {tab === 'wastage' ? (
            <Card>
              <Heading>Wastage by reason</Heading>
              <Table
                columns={[
                  { key: 'label', label: 'Reason', width: 160 },
                  { key: 'qty', label: 'Quantity', align: 'right', width: 110 },
                  { key: 'value', label: 'Value', align: 'right', width: 110 },
                ]}
                rows={report.data.wastage_by_reason.map((row: any) => ({
                  label: row.label,
                  qty: qty(row.qty),
                  value: money(row.value),
                }))}
              />
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function VarianceTable({ variance }: { variance: any }) {
  const palette = usePalette();
  if (variance.isLoading) return <Loading />;
  if (variance.error) return <ErrorNotice error={variance.error} />;
  const rows = variance.data?.rows ?? [];

  return (
    <Card>
      <Heading>Expected vs actual</Heading>
      <Caption>
        Sorted by rupee impact. An ingredient only raises an alert at 100% recipe coverage — anything
        less reads as &quot;incomplete recipes&quot; instead of crying wolf.
      </Caption>
      <Table
        columns={[
          { key: 'name', label: 'Ingredient', width: 150 },
          { key: 'expected', label: 'Expected', align: 'right', width: 90 },
          { key: 'actual', label: 'Actual', align: 'right', width: 90 },
          { key: 'wastage', label: 'Waste', align: 'right', width: 80 },
          { key: 'unexplained', label: 'Unexplained', align: 'right', width: 100 },
          { key: 'value', label: '₹ lost', align: 'right', width: 100 },
          { key: 'coverage', label: 'Coverage', align: 'right', width: 90 },
          { key: 'status', label: 'Status', width: 140 },
        ]}
        rows={rows.map((row: any) => ({
          name: row.name,
          expected: qty(row.expected),
          actual: qty(row.actual_used),
          wastage: qty(row.wastage),
          unexplained: qty(row.unexplained),
          value: money(row.unexplained_value),
          coverage: pct(row.coverage_pct),
          status: (
            <Caption tone={row.alert ? 'danger' : row.status === 'ok' ? 'success' : 'textMuted'}>
              {STATUS_LABELS[row.status] ?? row.status}
            </Caption>
          ),
        }))}
      />

      {rows.filter((row: any) => row.implied_portion).length ? (
        <>
          <View style={{ height: spacing.md }} />
          <Heading>Portion suggestions</Heading>
          {rows
            .filter((row: any) => row.implied_portion)
            .map((row: any) => (
              <Caption key={row.id}>
                {row.name}: your recipe says {row.implied_portion.recipe_qty_per_portion ?? '—'}{' '}
                {row.implied_portion.unit}, your kitchen is using about{' '}
                {row.implied_portion.implied_qty_per_portion} {row.implied_portion.unit} across{' '}
                {row.implied_portion.plates} plates. Update the recipe, or find out why.
              </Caption>
            ))}
        </>
      ) : null}
    </Card>
  );
}

const STATUS_LABELS: Record<string, string> = {
  alert: 'Unexplained loss',
  ok: 'Within tolerance',
  incomplete_recipes: 'Incomplete recipes',
  missing_counts: 'Counts missing',
  no_sales: 'No sales',
  no_expected: 'No recipe usage',
};
