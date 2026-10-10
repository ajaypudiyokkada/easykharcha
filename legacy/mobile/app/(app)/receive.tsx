import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { Platform, View } from 'react-native';

import { useAlerts, useBootstrap, useTenantQuery, useUpload } from '../../src/api/hooks';
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
  money,
  qty,
  today,
} from '../../src/ui';
import { EditDelete } from './wastage';

/**
 * Receive goods — ordering and receiving in one step, as a restaurant actually does it.
 *
 * Posted as multipart so the invoice photo rides along with the figures. The photo is stored only;
 * reading it automatically (OCR) is explicitly out of scope for now.
 */
export default function Receive() {
  const { can } = useSession();
  const bootstrap = useBootstrap();
  const alerts = useAlerts();
  const recent = useTenantQuery<any>('/recent?days=7');
  const openRequests = useTenantQuery<any>('/requests/?status=open');

  const [date, setDate] = useState(today());
  const [vendor, setVendor] = useState<number | null>(null);
  const [ingredient, setIngredient] = useState<number | null>(null);
  const [invoiced, setInvoiced] = useState('');
  const [received, setReceived] = useState('');
  const [rate, setRate] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [request, setRequest] = useState<number | null>(null);
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);

  const upload = useUpload('/purchases/');

  const ingredients = (bootstrap.data?.ingredients ?? []).filter((row: any) => !row.shared || true);
  const vendors = bootstrap.data?.vendors ?? [];
  const selected = ingredients.find((row: any) => row.id === ingredient);
  const matchingRequests = (openRequests.data?.results ?? openRequests.data ?? []).filter(
    (row: any) => !ingredient || row.ingredient === ingredient,
  );

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
    });
    if (!result.canceled) setPhoto(result.assets[0]);
  };

  const submit = () => {
    const form = new FormData();
    form.append('date', date);
    form.append('vendor', String(vendor));
    form.append('ingredient', String(ingredient));
    form.append('qty_invoiced', invoiced);
    form.append('qty_received', received || invoiced);
    form.append('rate', rate);
    if (invoiceRef) form.append('invoice_ref', invoiceRef);
    if (request) form.append('request', String(request));
    if (photo) {
      if (Platform.OS === 'web') {
        // On web the picker gives a blob: URL; fetching it back is how you get a File for FormData.
        fetch(photo.uri)
          .then((response) => response.blob())
          .then((blob) => {
            form.append('invoice_image', blob, photo.fileName ?? 'invoice.jpg');
            upload.mutate(form, { onSuccess: reset });
          });
        return;
      }
      form.append('invoice_image', {
        uri: photo.uri,
        name: photo.fileName ?? 'invoice.jpg',
        type: photo.mimeType ?? 'image/jpeg',
      } as never);
    }
    upload.mutate(form, { onSuccess: reset });
  };

  const reset = () => {
    setInvoiced('');
    setReceived('');
    setRate('');
    setInvoiceRef('');
    setPhoto(null);
    setRequest(null);
  };

  const short = invoiced && received && Number(received) < Number(invoiced);

  return (
    <Screen>
      <Title>Receive goods</Title>
      <Banner alerts={alerts.data ?? []} />

      <Card>
        <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
        <Picker
          label="Vendor"
          value={vendor}
          options={vendors.map((row: any) => ({ value: row.id as number, label: row.name }))}
          onChange={setVendor}
          emptyLabel="No vendors yet."
        />
        <Picker
          label="Ingredient"
          value={ingredient}
          options={ingredients.map((row: any) => ({ value: row.id as number, label: row.name }))}
          onChange={setIngredient}
        />
        <Field
          label={`Quantity invoiced${selected ? ` (${selected.unit})` : ''}`}
          value={invoiced}
          onChangeText={(next) => {
            setInvoiced(next);
            if (!received) setReceived(next);
          }}
          keyboardType="decimal-pad"
        />
        <Field
          label="Quantity actually received"
          value={received}
          onChangeText={setReceived}
          keyboardType="decimal-pad"
          hint="Different from invoiced? That is a short delivery, and it will be flagged."
        />
        <Field
          label={`Rate per ${selected?.unit ?? 'unit'}`}
          value={rate}
          onChangeText={setRate}
          keyboardType="decimal-pad"
          hint={selected ? `Standard rate ${money(selected.rate)}` : undefined}
        />
        <Field label="Invoice reference (optional)" value={invoiceRef} onChangeText={setInvoiceRef} />

        {matchingRequests.length ? (
          <Picker
            label="Fulfils an open request?"
            value={request}
            options={matchingRequests.map((row: any) => ({
              value: row.id as number,
              label: `${row.ingredient_name} ${qty(row.qty)}`,
            }))}
            onChange={setRequest}
          />
        ) : null}

        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Button
              label={photo ? 'Invoice photo attached' : 'Attach invoice photo'}
              variant="secondary"
              onPress={pickPhoto}
            />
          </View>
          {photo ? <Button label="Remove" variant="ghost" onPress={() => setPhoto(null)} /> : null}
        </View>

        {short ? <Notice tone="warning">Short delivery — this will appear as an alert.</Notice> : null}
        {invoiced && rate ? (
          <Caption>Invoice total: {money(Number(invoiced) * Number(rate))}</Caption>
        ) : null}

        <ErrorNotice error={upload.error} />
        <Button
          label="Record receipt"
          busy={upload.isPending}
          disabled={!vendor || !ingredient || !invoiced || !rate}
          onPress={submit}
        />
      </Card>

      <Card>
        <Heading>Last 7 days</Heading>
        {!recent.data?.purchases?.length ? (
          <Caption>Nothing received yet.</Caption>
        ) : (
          recent.data.purchases.map((entry: any) => (
            <Row
              key={entry.id}
              left={
                <>
                  <Body>
                    {entry.ingredient_name} — {qty(entry.qty_received, entry.unit)} @ {money(entry.rate)}
                  </Body>
                  <Caption tone={entry.is_short ? 'danger' : 'textMuted'}>
                    {entry.date} · {entry.vendor_name} · {money(entry.amount)}
                    {entry.is_short ? ` · short by ${qty(Number(entry.qty_invoiced) - Number(entry.qty_received), entry.unit)}` : ''}
                    {entry.invoice_image ? ' · photo attached' : ''}
                  </Caption>
                </>
              }
              right={can(Cap.ENTRY_EDIT) ? <EditDelete table="purchase" id={entry.id} /> : undefined}
            />
          ))
        )}
      </Card>
    </Screen>
  );
}
