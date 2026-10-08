import React, { useState } from 'react';

import { useTenantQuery } from '../src/api/hooks';
import { Cap, useSession } from '../src/state/session';
import { Body, Caption, Card, ErrorNotice, Loading, Picker, Row, Screen, Title } from '../src/ui';

export default function Audit() {
  const { can } = useSession();
  const [scope, setScope] = useState<'this' | 'all'>('this');
  const { data, isLoading, error } = useTenantQuery<any>(`/audit?scope=${scope}`);

  return (
    <Screen>
      <Title>Audit log</Title>
      <Caption>Every create, edit and delete. PINs are never recorded.</Caption>

      {can(Cap.AUDIT_VIEW_ALL) ? (
        <Picker
          label="Scope"
          value={scope}
          options={[
            { value: 'this' as const, label: 'This business' },
            { value: 'all' as const, label: 'All businesses' },
          ]}
          onChange={setScope}
        />
      ) : null}

      <ErrorNotice error={error} />
      {isLoading ? <Loading /> : null}

      <Card>
        {(data?.results ?? []).length === 0 ? (
          <Caption>Nothing recorded yet.</Caption>
        ) : (
          (data?.results ?? []).map((entry: any) => (
            <Row
              key={entry.id}
              left={
                <>
                  <Body>{entry.summary || entry.action}</Body>
                  <Caption>
                    {new Date(entry.at).toLocaleString()} · {entry.user_name ?? 'system'}
                    {scope === 'all' && entry.business_name ? ` · ${entry.business_name}` : ''}
                  </Caption>
                  {entry.detail?.changed ? (
                    <Caption>
                      {Object.entries(entry.detail.changed)
                        .map(([field, change]: [string, any]) => `${field}: ${change.from} → ${change.to}`)
                        .join(' · ')}
                    </Caption>
                  ) : null}
                </>
              }
            />
          ))
        )}
      </Card>
      {data?.count ? <Caption>{data.count} entries total.</Caption> : null}
    </Screen>
  );
}
