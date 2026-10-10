import React, { useState } from 'react';
import { View } from 'react-native';

import { useTenantQuery } from '../src/api/hooks';
import { RequireAuth } from '../src/components/RequireAuth';
import { radius, spacing } from '../src/theme';
import {
  Caption,
  Card,
  ErrorNotice,
  Heading,
  Loading,
  Picker,
  Screen,
  Table,
  Title,
  money,
  pct,
  usePalette,
} from '../src/ui';

export default function Trends() {
  return (
    <RequireAuth>
      <TrendsScreen />
    </RequireAuth>
  );
}

function TrendsScreen() {
  const palette = usePalette();
  const [weeks, setWeeks] = useState(8);
  const { data, isLoading, error } = useTenantQuery<any>(`/trends?weeks=${weeks}`);

  if (isLoading) return <Screen><Loading /></Screen>;
  if (error) return <Screen><ErrorNotice error={error} /></Screen>;

  const points = data?.total ?? [];
  const values = points.map((point: any) => Number(point.cost_pct ?? 0));
  const peak = Math.max(1, ...values);

  return (
    <Screen>
      <Title>Trends</Title>
      <Picker
        label="Window"
        value={weeks}
        options={[
          { value: 4, label: '4 weeks' },
          { value: 8, label: '8 weeks' },
          { value: 13, label: '13 weeks' },
          { value: 26, label: '26 weeks' },
        ]}
        onChange={setWeeks}
      />

      <Card>
        <Heading>Total food cost %</Heading>
        {/* A deliberately plain bar chart: no chart library, so it renders identically on web and native. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, height: 160, marginTop: spacing.md }}>
          {points.map((point: any, index: number) => {
            const value = Number(point.cost_pct ?? 0);
            return (
              <View key={index} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                <Caption>{point.cost_pct === null ? '' : Math.round(value)}</Caption>
                <View
                  style={{
                    width: '100%',
                    height: Math.max(2, (value / peak) * 110),
                    backgroundColor: point.cost_pct === null ? palette.border : palette.primary,
                    borderTopLeftRadius: radius.sm,
                    borderTopRightRadius: radius.sm,
                  }}
                />
                <Caption>{point.label}</Caption>
              </View>
            );
          })}
        </View>
        <Caption>A grey bar means there was no usable data that week — missing counts, not zero cost.</Caption>
      </Card>

      <Card>
        <Heading>Week by week</Heading>
        <Table
          columns={[
            { key: 'label', label: 'Week of', width: 100 },
            { key: 'revenue', label: 'Revenue', align: 'right', width: 110 },
            { key: 'cost', label: 'Cost', align: 'right', width: 110 },
            { key: 'costPct', label: 'Cost %', align: 'right', width: 90 },
          ]}
          rows={points.map((point: any) => ({
            label: point.label,
            revenue: money(point.revenue),
            cost: money(point.cost),
            costPct: pct(point.cost_pct),
          }))}
        />
      </Card>

      <Card>
        <Heading>By ingredient</Heading>
        <Table
          columns={[
            { key: 'name', label: 'Ingredient', width: 150 },
            ...points.map((point: any, index: number) => ({
              key: `w${index}`,
              label: point.label,
              align: 'right' as const,
              width: 80,
            })),
          ]}
          rows={(data?.ingredients ?? []).map((row: any) => {
            const cells: Record<string, string> = { name: row.name };
            row.points.forEach((point: any, index: number) => {
              cells[`w${index}`] = pct(point.cost_pct);
            });
            return cells;
          })}
        />
      </Card>
    </Screen>
  );
}
