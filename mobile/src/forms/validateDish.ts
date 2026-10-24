import { strings } from '../strings';
import { parseDecimalInput } from '../units';
import { findDuplicateName } from './groupItems';
import { validateRequiredNumber } from './validateNumber';
import type { DishDraft, DishFieldErrors, DishRowErrors } from './DishRecipeForm';

const sd = strings.dishForm;

const MAX_INGREDIENT_QTY = 100000;

/**
 * The dish form's own validation (Step 22a) — shared by the manual "Add a dish" create and edit
 * sheets, and by Step 22a2's onboarding dish form. Mirrors validateStockItem.ts's split:
 * client-side first for a fast, friendly message; the server re-checks everything regardless.
 */
export function validateDishDraft(
  draft: DishDraft,
  existingItems: { name: string }[],
): DishFieldErrors {
  const errors: DishFieldErrors = {};

  const name = draft.name.trim();
  if (!name) {
    errors.name = sd.errors.nameRequired;
  } else if (name.length > 120) {
    errors.name = sd.errors.nameTooLong;
  } else {
    const dup = findDuplicateName(existingItems, name);
    if (dup) errors.name = sd.errors.duplicateName(dup.name);
  }

  const priceCheck = validateRequiredNumber(draft.sellingPrice);
  if (priceCheck === 'required') errors.price = sd.errors.priceRequired;
  else if (priceCheck === 'invalid') errors.price = sd.errors.invalidNumber;
  else if (priceCheck === 'negative') errors.price = sd.errors.negativeNumber;

  if (draft.ingredients.length === 0) {
    errors.ingredients = sd.errors.ingredientsRequired;
    return errors;
  }

  const rows: Record<string, DishRowErrors> = {};
  const seenStockItemIds = new Set<number>();
  for (const row of draft.ingredients) {
    const rowErrors: DishRowErrors = {};
    if (row.stockItemId === null) {
      rowErrors.stockItem = sd.errors.rowStockItemRequired;
    } else if (seenStockItemIds.has(row.stockItemId)) {
      rowErrors.stockItem = sd.errors.rowDuplicate;
    } else {
      seenStockItemIds.add(row.stockItemId);
    }

    const amount = parseDecimalInput(row.amount);
    if (!row.amount.trim()) {
      rowErrors.amount = sd.errors.rowAmountRequired;
    } else if (amount === null) {
      rowErrors.amount = sd.errors.invalidNumber;
    } else if (amount === 0) {
      rowErrors.amount = sd.errors.rowAmountPositive;
    } else if (amount > MAX_INGREDIENT_QTY) {
      rowErrors.amount = sd.errors.rowAmountTooLarge;
    }

    if (Object.keys(rowErrors).length > 0) rows[row.key] = rowErrors;
  }

  if (Object.keys(rows).length > 0) {
    errors.ingredients = sd.errors.fixRows;
    errors.rows = rows;
  }

  return errors;
}
