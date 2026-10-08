import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { useBootstrap, useTenantMutation, useTenantQuery } from '../src/api/hooks';
import { Cap, useSession } from '../src/state/session';
import { spacing } from '../src/theme';
import {
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
} from '../src/ui';

type Tab = 'ingredients' | 'dishes' | 'vendors' | 'staff';

export default function Admin() {
  const [tab, setTab] = useState<Tab>('ingredients');
  const { can } = useSession();

  return (
    <Screen>
      <Title>Admin</Title>
      <Picker
        label="Section"
        value={tab}
        options={[
          { value: 'ingredients' as const, label: 'Ingredients' },
          { value: 'dishes' as const, label: 'Menu items' },
          { value: 'vendors' as const, label: 'Vendors' },
          ...(can(Cap.STAFF_MANAGE) ? [{ value: 'staff' as const, label: 'Staff' }] : []),
        ]}
        onChange={setTab}
      />
      {!can(Cap.CONFIG_EDIT) ? (
        <Notice>
          You can add new entries here. Editing and deleting existing ones is an Owner action, and every
          change is written to the audit log.
        </Notice>
      ) : null}

      {tab === 'ingredients' ? <Ingredients /> : null}
      {tab === 'dishes' ? <Dishes /> : null}
      {tab === 'vendors' ? <Vendors /> : null}
      {tab === 'staff' ? <Staff /> : null}
    </Screen>
  );
}

function Ingredients() {
  const { can } = useSession();
  const bootstrap = useBootstrap();
  const [form, setForm] = useState({
    code: '',
    name: '',
    unit: 'kg',
    rate: '',
    recipe_unit: 'g',
    recipe_units_per_stock_unit: '1000',
    yield_pct: '100',
    shared: false,
  });

  const create = useTenantMutation(() => ({ suffix: '/ingredients/', body: form }));
  const remove = useTenantMutation<{ id: number }>((variables) => ({
    suffix: `/ingredients/${variables.id}/`,
    method: 'DELETE' as const,
  }));

  return (
    <>
      <Card>
        <Heading>Add an ingredient</Heading>
        <Field label="Code" value={form.code} onChangeText={(code) => setForm({ ...form, code })} placeholder="CHK-BNL" />
        <Field label="Name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} />
        <Picker
          label="Stock unit"
          value={form.unit}
          options={[
            { value: 'kg', label: 'kg' },
            { value: 'l', label: 'litre' },
            { value: 'pc', label: 'piece' },
            { value: 'pkt', label: 'packet' },
          ]}
          onChange={(unit) =>
            setForm({ ...form, unit, recipe_units_per_stock_unit: unit === 'pc' || unit === 'pkt' ? '1' : '1000' })
          }
        />
        <Field label="Standard rate per unit" value={form.rate} onChangeText={(rate) => setForm({ ...form, rate })} keyboardType="decimal-pad" />
        <Picker
          label="Recipe unit"
          value={form.recipe_unit}
          options={[
            { value: 'g', label: 'grams' },
            { value: 'ml', label: 'ml' },
            { value: 'pc', label: 'pieces' },
          ]}
          onChange={(recipe_unit) => setForm({ ...form, recipe_unit })}
        />
        <Field
          label="Recipe units per stock unit"
          value={form.recipe_units_per_stock_unit}
          onChangeText={(value) => setForm({ ...form, recipe_units_per_stock_unit: value })}
          keyboardType="decimal-pad"
          hint="1000 g per kg, 1000 ml per litre, 1 per piece."
        />
        <Field
          label="Yield %"
          value={form.yield_pct}
          onChangeText={(yield_pct) => setForm({ ...form, yield_pct })}
          keyboardType="decimal-pad"
          hint="How much survives trimming and cooking. 100 = no loss."
        />
        <Picker
          label="Type"
          value={form.shared ? 'shared' : 'tracked'}
          options={[
            { value: 'tracked', label: 'Dish ingredient' },
            { value: 'shared', label: 'Misc / shared (oil, masala, packaging)' },
          ]}
          onChange={(value) => setForm({ ...form, shared: value === 'shared' })}
        />
        {form.shared ? (
          <Caption>
            Shared ingredients are pooled across every dish by revenue share. They never get recipe lines
            and never appear in the variance report.
          </Caption>
        ) : null}
        <ErrorNotice error={create.error} />
        <Button
          label="Add ingredient"
          busy={create.isPending}
          disabled={!form.code || !form.name}
          onPress={() => create.mutate(undefined as never, { onSuccess: () => setForm({ ...form, code: '', name: '', rate: '' }) })}
        />
      </Card>

      <Card>
        <Heading>Ingredients ({bootstrap.data?.ingredients?.length ?? 0})</Heading>
        <ErrorNotice error={remove.error} />
        {(bootstrap.data?.ingredients ?? []).map((row: any) => (
          <Row
            key={row.id}
            left={
              <>
                <Body>
                  {row.name} {row.shared ? '· misc' : ''}
                </Body>
                <Caption>
                  {row.code} · {money(row.rate)}/{row.unit} · recipe in {row.recipe_unit} ·
                  {' '}yield {row.yield_pct}%
                </Caption>
              </>
            }
            right={can(Cap.CONFIG_EDIT) ? <Button label="Delete" variant="ghost" onPress={() => remove.mutate({ id: row.id })} /> : undefined}
          />
        ))}
      </Card>
    </>
  );
}

function Dishes() {
  const { can } = useSession();
  const bootstrap = useBootstrap();
  const [form, setForm] = useState({ code: '', name: '', section: '', price: '', ing: null as number | null });

  const create = useTenantMutation(() => ({ suffix: '/dishes/', body: form }));
  const remove = useTenantMutation<{ id: number }>((variables) => ({
    suffix: `/dishes/${variables.id}/`,
    method: 'DELETE' as const,
  }));

  const selectable = (bootstrap.data?.ingredients ?? []).filter((row: any) => !row.shared);

  return (
    <>
      <Card>
        <Heading>Add a menu item</Heading>
        <Field label="Code" value={form.code} onChangeText={(code) => setForm({ ...form, code })} />
        <Field label="Name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} />
        <Field label="Section" value={form.section} onChangeText={(section) => setForm({ ...form, section })} placeholder="Starters" />
        <Field label="Price" value={form.price} onChangeText={(price) => setForm({ ...form, price })} keyboardType="decimal-pad" />
        <Picker
          label="Primary ingredient"
          value={form.ing}
          options={selectable.map((row: any) => ({ value: row.id as number, label: row.name }))}
          onChange={(ing) => setForm({ ...form, ing })}
          emptyLabel="Add a non-shared ingredient first."
        />
        <Caption>A misc/shared ingredient cannot be a menu item&apos;s primary ingredient.</Caption>
        <ErrorNotice error={create.error} />
        <Button
          label="Add menu item"
          busy={create.isPending}
          disabled={!form.code || !form.name || !form.ing}
          onPress={() => create.mutate(undefined as never, { onSuccess: () => setForm({ ...form, code: '', name: '', price: '' }) })}
        />
      </Card>

      <Card>
        <Heading>Menu ({bootstrap.data?.dishes?.length ?? 0})</Heading>
        <ErrorNotice error={remove.error} />
        {(bootstrap.data?.dishes ?? []).map((row: any) => (
          <Row
            key={row.id}
            left={
              <>
                <Body>{row.name}</Body>
                <Caption>
                  {row.section || 'No section'} · {money(row.price)} · {row.ing_name} ·{' '}
                  {row.has_recipe ? 'has recipe' : 'no recipe'}
                </Caption>
              </>
            }
            right={
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <Button label="Recipe" variant="secondary" onPress={() => router.push(`/recipe/${row.id}`)} />
                {can(Cap.CONFIG_EDIT) ? (
                  <Button label="Delete" variant="ghost" onPress={() => remove.mutate({ id: row.id })} />
                ) : null}
              </View>
            }
          />
        ))}
      </Card>
    </>
  );
}

function Vendors() {
  const { can } = useSession();
  const bootstrap = useBootstrap();
  const [form, setForm] = useState({ code: '', name: '', category: '', phone: '', terms: '' });
  const create = useTenantMutation(() => ({ suffix: '/vendors/', body: form }));
  const remove = useTenantMutation<{ id: number }>((variables) => ({
    suffix: `/vendors/${variables.id}/`,
    method: 'DELETE' as const,
  }));

  return (
    <>
      <Card>
        <Heading>Add a vendor</Heading>
        <Field label="Code" value={form.code} onChangeText={(code) => setForm({ ...form, code })} />
        <Field label="Name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} />
        <Field label="Category" value={form.category} onChangeText={(category) => setForm({ ...form, category })} />
        <Field label="Phone" value={form.phone} onChangeText={(phone) => setForm({ ...form, phone })} keyboardType="phone-pad" />
        <Field label="Terms" value={form.terms} onChangeText={(terms) => setForm({ ...form, terms })} placeholder="Weekly credit" />
        <ErrorNotice error={create.error} />
        <Button
          label="Add vendor"
          busy={create.isPending}
          disabled={!form.code || !form.name}
          onPress={() => create.mutate(undefined as never, { onSuccess: () => setForm({ code: '', name: '', category: '', phone: '', terms: '' }) })}
        />
      </Card>

      <Card>
        <Heading>Vendors ({bootstrap.data?.vendors?.length ?? 0})</Heading>
        <ErrorNotice error={remove.error} />
        {(bootstrap.data?.vendors ?? []).map((row: any) => (
          <Row
            key={row.id}
            left={
              <>
                <Body>{row.name}</Body>
                <Caption>
                  {row.code} · {row.category || 'No category'} {row.terms ? `· ${row.terms}` : ''}
                  {row.in_use ? ' · in use' : ''}
                </Caption>
              </>
            }
            right={can(Cap.CONFIG_EDIT) && !row.in_use ? <Button label="Delete" variant="ghost" onPress={() => remove.mutate({ id: row.id })} /> : undefined}
          />
        ))}
      </Card>
    </>
  );
}

function Staff() {
  const list = useTenantQuery<any>('/access');
  const [form, setForm] = useState({ phone: '', name: '', role: 'staff', pin: '' });
  const create = useTenantMutation(() => ({ suffix: '/access', body: form }));
  const revoke = useTenantMutation<{ id: number }>((variables) => ({
    suffix: `/access/${variables.id}`,
    method: 'DELETE' as const,
  }));

  return (
    <>
      <Card>
        <Heading>Add or update a person</Heading>
        <Field label="Phone number" value={form.phone} onChangeText={(phone) => setForm({ ...form, phone })} keyboardType="phone-pad" />
        <Field label="Name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} />
        <Picker
          label="Role"
          value={form.role}
          options={[
            { value: 'staff', label: 'Staff' },
            { value: 'head_chef', label: 'Head Chef' },
            { value: 'manager', label: 'Manager' },
            { value: 'owner', label: 'Owner' },
          ]}
          onChange={(role) => setForm({ ...form, role })}
        />
        <Field
          label="Starting PIN (new people only)"
          value={form.pin}
          onChangeText={(pin) => setForm({ ...form, pin })}
          keyboardType="number-pad"
          secureTextEntry
          hint="They will be asked to change it on first sign-in."
        />
        <ErrorNotice error={create.error} />
        <Button
          label="Save"
          busy={create.isPending}
          disabled={!form.phone}
          onPress={() => create.mutate(undefined as never, { onSuccess: () => setForm({ phone: '', name: '', role: 'staff', pin: '' }) })}
        />
      </Card>

      <Card>
        <Heading>People</Heading>
        <ErrorNotice error={revoke.error} />
        {(list.data ?? []).map((row: any) => (
          <Row
            key={row.id}
            left={
              <>
                <Body>{row.name || row.phone}</Body>
                <Caption>
                  {row.phone} · {row.role}
                  {row.global ? ' · all businesses' : ''}
                  {row.active ? '' : ' · revoked'}
                </Caption>
              </>
            }
            right={row.active ? <Button label="Revoke" variant="ghost" onPress={() => revoke.mutate({ id: row.id })} /> : undefined}
          />
        ))}
      </Card>
    </>
  );
}
