import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { useTenantQuery } from '../../src/api/hooks';
import { useSession } from '../../src/state/session';
import { spacing } from '../../src/theme';
import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  ErrorNotice,
  Heading,
  Loading,
  Row,
  Screen,
  Stat,
  Title,
  money,
  pct,
  qty,
} from '../../src/ui';

export default function Home() {
  const { tenant } = useSession();
  const { data, isLoading, error, refetch, isRefetching } = useTenantQuery<any>('/home');

  if (isLoading) return <Screen><Loading /></Screen>;
  if (error) return <Screen><ErrorNotice error={error} /><Button label="Retry" onPress={() => refetch()} /></Screen>;
  if (!data) return null;

  return (
    <Screen refreshing={isRefetching}>
      <View>
        <Title>{tenant?.name}</Title>
        <Caption>
          {data.business?.tagline || tenant?.business_type_label} · {data.date}
        </Caption>
      </View>

      <Banner alerts={data.alerts ?? []} />

      {data.tasks ? <CaptureDashboard data={data} /> : null}
      {data.sales_status ? <ManagerDashboard data={data} /> : null}
      {data.week_to_date ? <OwnerDashboard data={data} /> : null}
    </Screen>
  );
}

/** Staff / Head Chef. Blind by construction — the server sends no sales or variance here (§1b). */
function CaptureDashboard({ data }: { data: any }) {
  return (
    <>
      <Card>
        <Heading>Today&apos;s tasks</Heading>
        {data.tasks.map((task: any) => (
          <Row
            key={task.key}
            left={
              <>
                <Body>{task.label}</Body>
                <Caption tone={task.done >= task.total ? 'success' : 'warning'}>
                  {task.done} of {task.total} recorded
                  {task.pending.length ? ` · next: ${task.pending.slice(0, 3).join(', ')}` : ''}
                </Caption>
              </>
            }
          />
        ))}
        <View style={{ height: spacing.sm }} />
        <Button label="Go to stock" onPress={() => router.push('/(app)/stock')} />
      </Card>

      {data.my_requests?.length ? (
        <Card>
          <Heading>My open requests</Heading>
          {data.my_requests.map((request: any) => (
            <Row
              key={request.id}
              left={<Body>{request.ingredient}</Body>}
              right={<Caption>{qty(request.qty)}</Caption>}
            />
          ))}
        </Card>
      ) : null}
    </>
  );
}

/** Manager. Sales capture status, open requests, short deliveries — no variance (Owner-only). */
function ManagerDashboard({ data }: { data: any }) {
  const status = data.sales_status;
  return (
    <>
      <Card>
        <Heading>Sales today</Heading>
        <Body muted>
          {status.dishes_recorded_today} of {status.dishes_active} menu items recorded.
        </Body>
        {status.last_import ? (
          <Caption>
            Last import: {status.last_import.filename} ({status.last_import.rows_matched} matched,{' '}
            {status.last_import.rows_unmatched} unmatched)
          </Caption>
        ) : (
          <Caption>No POS import yet.</Caption>
        )}
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label="Enter sales" onPress={() => router.push('/(app)/sales')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Import" variant="secondary" onPress={() => router.push('/sales-import')} />
          </View>
        </View>
      </Card>

      <Card>
        <Heading>Open requests ({data.open_requests.length})</Heading>
        {data.open_requests.length === 0 ? (
          <Caption>Nothing waiting.</Caption>
        ) : (
          data.open_requests.map((request: any) => (
            <Row
              key={request.id}
              left={
                <>
                  <Body>{request.ingredient}</Body>
                  <Caption>
                    {qty(request.qty)} · asked by {request.requested_by} on {request.date}
                  </Caption>
                </>
              }
            />
          ))
        )}
      </Card>

      {data.short_deliveries?.length ? (
        <Card>
          <Heading>Short deliveries</Heading>
          <Banner alerts={data.short_deliveries} />
        </Card>
      ) : null}
    </>
  );
}

/** Owner / Super Admin. */
function OwnerDashboard({ data }: { data: any }) {
  const week = data.week_to_date;
  return (
    <>
      <Card>
        <Heading>Week to date</Heading>
        <Caption>
          {data.week.start} → {data.week.through}
        </Caption>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm }}>
          <Stat label="Revenue" value={money(week.revenue)} />
          <Stat label="Food cost" value={money(week.cost)} />
          <Stat
            label={`Cost % (target ${pct(week.target_pct)})`}
            value={pct(week.cost_pct)}
            tone={week.over_target ? 'danger' : 'success'}
          />
          <Stat label="Plates" value={String(week.plates)} />
        </View>
        {week.complete ? null : (
          <Caption tone="warning">
            Based on {week.ingredients_costed} of {week.ingredients_total} ingredients — counts are
            missing for {week.ingredients_missing_counts.slice(0, 3).join(', ')}
            {week.ingredients_missing_counts.length > 3 ? ' and others' : ''}. The real cost is higher
            than this.
          </Caption>
        )}
      </Card>

      <Card>
        <Heading>Kitchen efficiency</Heading>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          <Stat label="Efficiency" value={pct(data.kitchen_efficiency_pct)} />
          <Stat
            label="Unexplained loss"
            value={money(data.unexplained_loss_value)}
            tone={Number(data.unexplained_loss_value) > 0 ? 'danger' : undefined}
          />
        </View>
        <Caption>
          Only ingredients with complete recipes count. Everything else shows as &quot;incomplete
          recipes&quot; in the variance report rather than raising a false alarm.
        </Caption>
      </Card>

      {data.top_variances?.length ? (
        <Card>
          <Heading>Top variances</Heading>
          {data.top_variances.map((row: any) => (
            <Row
              key={row.id}
              left={
                <>
                  <Body>{row.name}</Body>
                  <Caption tone={row.alert ? 'danger' : 'textMuted'}>
                    expected {qty(row.expected, row.unit)} · actual {qty(row.actual_used, row.unit)} ·
                    unexplained {qty(row.unexplained, row.unit)} ({pct(row.unexplained_pct)})
                  </Caption>
                </>
              }
              right={<Body>{money(row.unexplained_value)}</Body>}
            />
          ))}
          <Button label="Full report" variant="secondary" onPress={() => router.push('/(app)/report')} />
        </Card>
      ) : null}

      {data.segregation_flags?.length ? (
        <Card>
          <Heading>Segregation of duties</Heading>
          {data.segregation_flags.map((flag: any, index: number) => (
            <Caption key={index} tone="warning">
              {flag.message}
            </Caption>
          ))}
          <Caption>
            Flagged, not blocked — a small team legitimately shares these jobs. Worth a look, not an
            accusation.
          </Caption>
        </Card>
      ) : null}
    </>
  );
}
