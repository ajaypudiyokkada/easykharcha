import * as DocumentPicker from 'expo-document-picker';
import React, { useState } from 'react';
import { Platform, View } from 'react-native';

import { api } from '../src/api/client';
import { useBootstrap, useTenantPath } from '../src/api/hooks';
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
  Title,
  money,
} from '../src/ui';

/**
 * POS sales import.
 *
 * The file is sent twice — once to preview, once to confirm. That is deliberate: the confirm endpoint
 * re-parses the file server-side rather than trusting a preview payload posted back, so nobody can
 * confirm plate counts that were never in the report.
 */
export default function SalesImport() {
  const { tenant } = useSession();
  const path = useTenantPath();
  const bootstrap = useBootstrap();

  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [aliases, setAliases] = useState<Record<string, number>>({});
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const pick = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '*/*'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    setFile(picked.assets[0]);
    setPreview(null);
    setResult(null);
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
    return form;
  };

  const run = async (step: 'preview' | 'confirm') => {
    setError(null);
    setBusy(true);
    try {
      const form = await buildForm();
      if (step === 'confirm' && Object.keys(aliases).length) {
        form.append('aliases', JSON.stringify(aliases));
      }
      const response = await api(path(`/sales/import/${step}`), { method: 'POST', form });
      if (step === 'preview') setPreview(response);
      else setResult(response);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const dishes = bootstrap.data?.dishes ?? [];

  return (
    <Screen>
      <Title>Import sales</Title>
      <Caption>
        Upload the item-wise sales report from your POS (CSV or XLSX). We reconcile physical counts
        against sales — we do not try to keep a running system inventory.
      </Caption>

      <Card>
        <Button label={file ? `Selected: ${file.name}` : 'Choose a file'} variant="secondary" onPress={pick} />
        <ErrorNotice error={error} />
        <Button label="Preview" busy={busy} disabled={!file} onPress={() => run('preview')} />
      </Card>

      {preview ? (
        <>
          <Card>
            <Heading>
              {preview.matched.length} matched · {preview.unmatched.length} unmatched
            </Heading>
            <Caption>
              {preview.date_from} → {preview.date_to} · {preview.rows_read} rows read
            </Caption>
            {preview.matched.slice(0, 30).map((row: any, index: number) => (
              <Row
                key={index}
                left={
                  <>
                    <Body>{row.dish_name}</Body>
                    <Caption>
                      {row.date} · {row.plates} plates · {money(row.revenue)}
                    </Caption>
                  </>
                }
              />
            ))}
          </Card>

          {preview.blocked_by_manual?.length ? (
            <Notice tone="warning">
              {preview.blocked_by_manual.length} row(s) already have a manually entered figure for the
              same item and date. Manual entries are never overwritten by an import — delete the manual
              row first if the POS figure is the right one.
            </Notice>
          ) : null}

          {preview.unmatched.length ? (
            <Card>
              <Heading>Unmatched items</Heading>
              <Caption>
                Map each one to a menu item. We only suggest — an automatic fuzzy match would quietly
                attribute one item&apos;s plates to another.
              </Caption>
              {preview.unmatched.map((row: any) => (
                <View key={row.item} style={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
                  <Body>
                    {row.item} — {row.plates} plates
                  </Body>
                  {row.suggestion ? (
                    <Caption>Looks like &quot;{row.suggestion.dish_name}&quot;</Caption>
                  ) : null}
                  <Picker
                    label="Map to"
                    value={aliases[row.item] ?? row.suggestion?.dish ?? null}
                    options={dishes.map((dish: any) => ({ value: dish.id as number, label: dish.name }))}
                    onChange={(dishId) => setAliases({ ...aliases, [row.item]: dishId })}
                  />
                </View>
              ))}
            </Card>
          ) : null}

          {preview.problems?.length ? (
            <Notice tone="warning">
              {preview.problems.length} row(s) could not be read: {preview.problems.slice(0, 3).map((p: any) => `row ${p.row} (${p.reason})`).join(', ')}
            </Notice>
          ) : null}

          <Button
            label="Confirm import"
            busy={busy}
            disabled={preview.matched.length === 0 && Object.keys(aliases).length === 0}
            onPress={() => run('confirm')}
          />
          <Caption>
            Re-importing the same dates replaces only previously imported rows. Manual entries stay.
          </Caption>
        </>
      ) : null}

      {result ? (
        <Notice tone="success">
          Imported {result.created} row(s) from {result.import.filename} ({result.import.date_from} →{' '}
          {result.import.date_to}).
          {result.unmatched?.length ? ` ${result.unmatched.length} item(s) still unmatched.` : ''}
        </Notice>
      ) : null}

      <Caption>
        Direct POS API sync is not built: Petpooja&apos;s third-party API availability and terms are
        unconfirmed.
      </Caption>
    </Screen>
  );
}
