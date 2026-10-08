import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { get } from '../../src/api/client';
import { useBootstrap, useTenantMutation, useTenantQuery } from '../../src/api/hooks';
import { Cap, useSession } from '../../src/state/session';
import { spacing } from '../../src/theme';
import {
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
  Row,
  Screen,
  Stat,
  Title,
  money,
  pct,
} from '../../src/ui';

/**
 * Recipe editor for one menu item.
 *
 * "Start from template" copies a global starter recipe in, mapped by canonical ingredient tag. The
 * copy is one-way: later edits to the global library never reach back into this recipe.
 */
export default function Recipe() {
  const { dish: dishId } = useLocalSearchParams<{ dish: string }>();
  const { can, tenant } = useSession();
  const bootstrap = useBootstrap();
  const recipe = useTenantQuery<any>(`/dishes/${dishId}/recipe/`);

  const [ingredient, setIngredient] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [templateCode, setTemplateCode] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);

  const addLine = useTenantMutation(() => ({
    suffix: `/dishes/${dishId}/recipe/`,
    body: { ingredient, qty_per_portion: amount },
  }));
  const removeLine = useTenantMutation<{ id: number }>((variables) => ({
    suffix: `/recipe-lines/${variables.id}/`,
    method: 'DELETE' as const,
  }));
  const adopt = useTenantMutation(() => ({
    suffix: `/dishes/${dishId}/recipe/adopt`,
    body: { template: templateCode },
  }));

  const loadPreview = async (code: string) => {
    setPreviewError(null);
    setTemplateCode(code);
    try {
      setPreview(await get(`/tenants/${tenant?.id}/dishes/${dishId}/recipe/adopt?template=${code}`));
    } catch (caught) {
      setPreviewError(caught);
    }
  };

  const suggestions = useTenantQuery<any>(`/dishes/${dishId}/recipe/adopt`);

  if (recipe.isLoading) return <Screen><Loading /></Screen>;
  if (recipe.error) return <Screen><ErrorNotice error={recipe.error} /></Screen>;

  const dish = recipe.data?.dish;
  const lines = recipe.data?.lines ?? [];
  const standard = recipe.data?.standard_cost_per_plate;
  const selectable = (bootstrap.data?.ingredients ?? []).filter((row: any) => !row.shared);
  const margin = dish && standard !== null ? Number(dish.price) - Number(standard) : null;

  return (
    <Screen>
      <Title>{dish?.name}</Title>
      <Caption>Recipe — grams per portion</Caption>

      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          <Stat label="Menu price" value={money(dish?.price)} />
          <Stat label="Standard cost/plate" value={money(standard)} />
          <Stat
            label="Margin"
            value={margin === null ? '—' : money(margin)}
            tone={margin !== null && margin < 0 ? 'danger' : 'success'}
          />
          <Stat
            label="Cost %"
            value={dish && Number(dish.price) > 0 && standard !== null ? pct((Number(standard) / Number(dish.price)) * 100) : '—'}
          />
        </View>
        {dish && Number(dish.price) === 0 ? (
          <Notice tone="warning">This item has a ₹0 price, so margin and cost % cannot be computed.</Notice>
        ) : null}
      </Card>

      <Card>
        <Heading>Lines</Heading>
        {lines.length === 0 ? (
          <Caption>
            No recipe yet. That is fine — this item still gets costed by revenue share. Adding a recipe
            is what unlocks expected-vs-actual variance.
          </Caption>
        ) : (
          lines.map((line: any) => (
            <Row
              key={line.id}
              left={
                <>
                  <Body>
                    {line.ingredient_name} — {line.qty_per_portion} {line.recipe_unit}
                  </Body>
                  <Caption>
                    {money(line.line_cost)} per plate · {CONFIDENCE[line.confidence] ?? line.confidence}
                  </Caption>
                </>
              }
              right={
                can(Cap.CONFIG_EDIT) ? (
                  <Button label="Remove" variant="ghost" onPress={() => removeLine.mutate({ id: line.id })} />
                ) : undefined
              }
            />
          ))
        )}
        <ErrorNotice error={removeLine.error} />
      </Card>

      {can(Cap.CONFIG_ADD) ? (
        <Card>
          <Heading>Add a line</Heading>
          <Picker
            label="Ingredient"
            value={ingredient}
            options={selectable.map((row: any) => ({ value: row.id as number, label: row.name }))}
            onChange={setIngredient}
          />
          <Field
            label="Quantity per portion"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            hint="In the ingredient's recipe unit — grams, usually."
          />
          <ErrorNotice error={addLine.error} />
          <Button
            label="Add line"
            busy={addLine.isPending}
            disabled={!ingredient || !amount}
            onPress={() => addLine.mutate(undefined as never, { onSuccess: () => setAmount('') })}
          />
        </Card>
      ) : null}

      {can(Cap.CONFIG_ADD) ? (
        <Card>
          <Heading>Start from a template</Heading>
          {suggestions.data?.suggestions?.length ? (
            <Picker
              label="Suggested templates"
              value={templateCode}
              options={suggestions.data.suggestions.map((row: any) => ({ value: row.code as string, label: row.name }))}
              onChange={loadPreview}
            />
          ) : (
            <Caption>
              No template looks like this item. The starter library only carries values an owner actually
              stated — made-up grams would produce false variance alerts.
            </Caption>
          )}
          <ErrorNotice error={previewError} />
          {preview ? (
            <>
              {preview.matched.map((line: any) => (
                <Caption key={line.canonical}>
                  ✓ {line.ingredient_name}: {line.qty_per_portion} {line.unit} ({CONFIDENCE[line.confidence]})
                </Caption>
              ))}
              {preview.ambiguous.map((line: any) => (
                <Caption key={line.canonical} tone="warning">
                  ? {line.canonical_name}: several of your ingredients carry this tag — pick one first.
                </Caption>
              ))}
              {preview.unmatched.map((line: any) => (
                <Caption key={line.canonical} tone="danger">
                  ✗ {line.message}
                </Caption>
              ))}
              <ErrorNotice error={adopt.error} />
              <Button
                label="Adopt this template"
                busy={adopt.isPending}
                disabled={!preview.ready}
                onPress={() => adopt.mutate(undefined as never, { onSuccess: () => setPreview(null) })}
              />
              <Caption>
                Adopting copies the numbers. Later edits to the global template never change this recipe.
              </Caption>
            </>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

const CONFIDENCE: Record<string, string> = {
  owner_stated: 'owner stated',
  typical: 'typical — verify before trusting',
  calibrated: 'measured here',
};
