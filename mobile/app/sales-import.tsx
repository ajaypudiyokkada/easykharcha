import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { api, get } from '../src/api/client';
import { useBootstrap, useTenantPath } from '../src/api/hooks';
import { RequireAuth } from '../src/components/RequireAuth';
import { useSession } from '../src/state/session';
import { spacing } from '../src/theme';
import {
  Body,
  Button,
  Caption,
  Card,
  ErrorNotice,
  Heading,
  Notice,
  Picker,
  Row,
  Screen,
  Stat,
  Title,
  money,
  qty,
} from '../src/ui';

type Format = { key: string; label: string; hint: string; sample_headers: string[] };
type Unmatched = {
  item: string;
  plates: number;
  revenue: number;
  rows: number;
  suggestions: { dish: number; dish_name: string; score: number }[];
};

/** "skip" means import without this item; a number means map it to that dish. */
type Choice = number | 'skip' | null;

/**
 * POS sales import.
 *
 * The file is sent twice — once to preview, once to confirm. That is deliberate: confirm re-parses it
 * server-side rather than trusting a preview payload posted back, so nobody can confirm plate counts
 * that were never in the report.
 */
export default function SalesImport() {
  return (
    <RequireAuth>
      <SalesImportScreen />
    </RequireAuth>
  );
}

function SalesImportScreen() {
  const { tenant } = useSession();
  const path = useTenantPath();
  const bootstrap = useBootstrap();

  const [formats, setFormats] = useState<Format[]>([]);
  const [format, setFormat] = useState('auto');
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Depend on the tenant id, not on `path`: useTenantPath returns a fresh closure every render, so
  // listing it here re-ran this effect on every state change and the dropdown never settled.
  const tenantId = tenant?.id;
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    get(`/tenants/${tenantId}/sales/import/formats`)
      .then((data) => {
        if (!cancelled) setFormats(data.formats ?? []);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const dishes = bootstrap.data?.dishes ?? [];
  const unmatched: Unmatched[] = preview?.unmatched ?? [];
  const allResolved = unmatched.every((row) => choices[row.item] != null);

  const pick = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: [
        'text/csv',
        'text/comma-separated-values',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '*/*',
      ],
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    setFile(picked.assets[0]);
    setPreview(null);
    setResult(null);
    setChoices({});
    setError(null);
  };

  const buildForm = async () => {
    const form = new FormData();
    if (!file) return form;
    if (Platform.OS === 'web') {
      const blob = await fetch(file.uri).then((response) => response.blob());
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'text/csv' } as never);
    }
    form.append('format', format);
    return form;
  };

  const run = async (step: 'preview' | 'confirm') => {
    setError(null);
    setBusy(true);
    try {
      const form = await buildForm();
      if (step === 'confirm') {
        const aliases: Record<string, number> = {};
        for (const [item, choice] of Object.entries(choices)) {
          if (typeof choice === 'number') aliases[item] = choice;
        }
        if (Object.keys(aliases).length) form.append('aliases', JSON.stringify(aliases));
      }
      const response = await api(path(`/sales/import/${step}`), { method: 'POST', form });
      if (step === 'preview') {
        setPreview(response);
        // Pre-select the top suggestion so the common case is one tap, but never auto-confirm it.
        const seeded: Record<string, Choice> = {};
        (response.unmatched ?? []).forEach((row: Unmatched) => {
          seeded[row.item] = row.suggestions?.[0]?.dish ?? null;
        });
        setChoices(seeded);
      } else {
        setResult(response);
        setPreview(null);
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const reconciliation = preview?.reconciliation;

  return (
    <Screen>
      <Title>Import sales</Title>
      <Caption>
        Upload the item-wise sales report from your POS. We reconcile physical counts against sales — we
        do not try to keep a running system inventory.
      </Caption>

      <Card>
        <Picker
          label="Source"
          value={format}
          options={[
            { value: 'auto', label: 'Auto-detect' },
            ...formats.map((entry) => ({ value: entry.key, label: entry.label })),
          ]}
          onChange={setFormat}
        />
        {format !== 'auto' ? (
          <Caption>{formats.find((entry) => entry.key === format)?.hint}</Caption>
        ) : (
          <Caption>We work out the format from the column headings, not the file name.</Caption>
        )}
        <Button label={file ? `Selected: ${file.name}` : 'Choose a file'} variant="secondary" onPress={pick} />
        <ErrorNotice error={error} />
        <Button label="Preview" busy={busy} disabled={!file} onPress={() => run('preview')} />
        <Caption>Preview writes nothing.</Caption>
      </Card>

      {preview ? (
        <>
          <Card>
            <Heading>{preview.format?.label}</Heading>
            <Caption>
              {preview.date_from} → {preview.date_to}
            </Caption>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm }}>
              <Stat label="Rows read" value={String(preview.counts.rows_read)} />
              <Stat label="Included" value={String(preview.counts.rows_included)} />
              <Stat
                label="Excluded"
                value={String(preview.counts.rows_excluded)}
                tone={preview.counts.rows_excluded ? 'warning' : undefined}
              />
              <Stat label="Matched" value={String(preview.counts.matched_groups)} />
              <Stat
                label="Unmatched"
                value={String(preview.counts.unmatched_items)}
                tone={preview.counts.unmatched_items ? 'warning' : undefined}
              />
            </View>
          </Card>

          {reconciliation ? (
            <Notice
              tone={
                reconciliation.matches === false
                  ? 'warning'
                  : reconciliation.matches === true
                    ? 'success'
                    : 'info'
              }
            >
              {reconciliation.message}
            </Notice>
          ) : null}

          {preview.warnings?.map((warning: string, index: number) => (
            <Notice key={index} tone="warning">
              {warning}
            </Notice>
          ))}

          {preview.counts.rows_excluded ? (
            <Card>
              <Heading>Excluded rows ({preview.counts.rows_excluded})</Heading>
              {Object.entries(preview.counts.excluded_by_reason).map(([reason, count]) => (
                <Caption key={reason}>
                  {String(count)} × {reason}
                </Caption>
              ))}
            </Card>
          ) : null}

          {preview.blocked_by_manual?.length ? (
            <Notice tone="warning">
              {preview.blocked_by_manual.length} day/item figure(s) were entered by hand already.
              Manual entries are never overwritten by an import — delete the manual row first if the
              POS figure is the right one.
            </Notice>
          ) : null}

          {unmatched.length ? (
            <Card>
              <Heading>Unmatched items ({unmatched.length})</Heading>
              <Caption>
                {qty(preview.unmatched_impact?.plates)} plates and{' '}
                {money(preview.unmatched_impact?.revenue)} are affected. Map each item or skip it — we
                only suggest, because an automatic near-match would quietly move one item&apos;s plates
                onto another.
              </Caption>
              {unmatched.map((row) => (
                <View key={row.item} style={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
                  <Body>
                    {row.item} — {row.plates} plates, {money(row.revenue)}
                  </Body>
                  <Picker
                    label="Map to"
                    value={choices[row.item] ?? null}
                    options={[
                      ...dishes.map((dish: any) => ({
                        value: dish.id as number | 'skip',
                        label:
                          row.suggestions?.[0]?.dish === dish.id
                            ? `${dish.name}  (suggested)`
                            : dish.name,
                      })),
                      { value: 'skip' as const, label: "Skip — don't import" },
                    ]}
                    onChange={(value) => setChoices({ ...choices, [row.item]: value as Choice })}
                  />
                </View>
              ))}
            </Card>
          ) : null}

          <Card>
            <Heading>Will import</Heading>
            {preview.matched.slice(0, 40).map((row: any, index: number) => (
              <Row
                key={index}
                left={
                  <>
                    <Body>{row.dish_name}</Body>
                    <Caption>
                      {row.date} · {row.plates} plates · {money(row.revenue)}
                      {row.channel ? ` · ${row.channel}` : ''}
                    </Caption>
                  </>
                }
              />
            ))}
            {preview.matched.length > 40 ? (
              <Caption>+{preview.matched.length - 40} more</Caption>
            ) : null}
          </Card>

          <Button
            label="Confirm import"
            busy={busy}
            disabled={!allResolved || preview.matched.length === 0}
            onPress={() => run('confirm')}
          />
          {!allResolved ? (
            <Caption tone="warning">Map or skip every unmatched item before importing.</Caption>
          ) : null}
          <Caption>
            Re-importing the same dates replaces only previously imported rows. Manual entries stay.
            Confirming the same file twice does nothing.
          </Caption>
        </>
      ) : null}

      {result ? (
        <Notice tone={result.already_imported ? 'warning' : 'success'}>
          {result.message}
          {result.replaced ? ` Replaced ${result.replaced} previously imported row(s).` : ''}
        </Notice>
      ) : null}

      <Caption>
        Uploaded files are parsed in memory and never stored, and no customer column is ever read.
        Direct POS API sync is not built: Petpooja&apos;s third-party API availability and terms are
        unconfirmed.
      </Caption>
    </Screen>
  );
}
