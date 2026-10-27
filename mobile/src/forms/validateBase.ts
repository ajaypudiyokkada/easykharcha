import { strings } from '../strings';
import { parseDecimalInput } from '../units';
import { findDuplicateName } from './groupItems';
import type { BaseDraft, BaseFieldErrors, BaseRowErrors } from './BaseRecipeForm';

const bs = strings.settings.bases;

const MAX_INGREDIENT_QTY = 100000;

/** Client-side validation for the batch-recipe ("base") form — mirrors validateDish.ts's split:
 * a fast, friendly message here; the server re-checks everything regardless. */
export function validateBaseDraft(
  draft: BaseDraft,
  existingItems: { name: string }[],
): BaseFieldErrors {
  const errors: BaseFieldErrors = {};

  const name = draft.name.trim();
  if (!name) {
    errors.name = bs.errors.nameRequired;
  } else {
    const dup = findDuplicateName(existingItems, name);
    if (dup) errors.name = bs.errors.duplicateName(dup.name);
  }

  if (draft.ingredients.length === 0) {
    errors.ingredients = bs.errors.ingredientsRequired;
    return errors;
  }

  const rows: Record<string, BaseRowErrors> = {};
  const seenStockItemIds = new Set<number>();
  for (const row of draft.ingredients) {
    const rowErrors: BaseRowErrors = {};
    if (row.stockItemId === null) {
      rowErrors.stockItem = 'Choose an item.';
    } else if (seenStockItemIds.has(row.stockItemId)) {
      rowErrors.stockItem = 'Already added above.';
    } else {
      seenStockItemIds.add(row.stockItemId);
    }

    const amount = parseDecimalInput(row.amount);
    if (!row.amount.trim()) {
      rowErrors.amount = 'Enter an amount.';
    } else if (amount === null) {
      rowErrors.amount = bs.errors.invalidNumber;
    } else if (amount <= 0) {
      rowErrors.amount = "This can't be zero.";
    } else if (amount > MAX_INGREDIENT_QTY) {
      rowErrors.amount = 'Enter a smaller amount.';
    }

    if (Object.keys(rowErrors).length > 0) rows[row.key] = rowErrors;
  }

  if (Object.keys(rows).length > 0) {
    errors.ingredients = bs.errors.ingredientsRequired;
    errors.rows = rows;
  }

  return errors;
}
