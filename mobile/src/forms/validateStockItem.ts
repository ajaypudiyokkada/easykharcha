import { strings } from '../strings';
import { findDuplicateName } from './groupItems';
import { validateOptionalNumber, validateRequiredNumber } from './validateNumber';
import type { StockItemDraft } from './StockItemForm';

const s3 = strings.setup.step3;

export type StockItemFieldErrors = {
  name?: string;
  unit?: string;
  usualPrice?: string;
  shelfLifeDays?: string;
};

/** Shared by setup/3's inline add form and Settings' StockItemSheet — the same rules in exactly
 * one place, client-side (the server re-checks all of it regardless; this just gets a plain
 * message in front of someone before a round-trip even starts). `existingItems` excludes the item
 * being edited, if any. */
export function validateStockItemDraft(
  draft: StockItemDraft,
  existingItems: { name: string }[],
): StockItemFieldErrors {
  const errors: StockItemFieldErrors = {};

  const name = draft.name.trim();
  if (!name) {
    errors.name = s3.errors.nameRequired;
  } else if (name.length > 120) {
    errors.name = s3.errors.nameTooLong;
  } else {
    const dup = findDuplicateName(existingItems, name);
    if (dup) errors.name = s3.errors.duplicateName(dup.name);
  }

  if (!draft.unit) errors.unit = s3.errors.unitRequired;

  const priceCheck = validateOptionalNumber(draft.usualPrice);
  if (priceCheck === 'invalid') errors.usualPrice = s3.errors.invalidNumber;
  else if (priceCheck === 'negative') errors.usualPrice = s3.errors.negativeNumber;

  if (draft.goesOff) {
    if (!draft.shelfLifeDays.trim()) {
      errors.shelfLifeDays = s3.errors.shelfLifeRequired;
    } else {
      const shelfCheck = validateRequiredNumber(draft.shelfLifeDays);
      if (shelfCheck === 'negative') errors.shelfLifeDays = s3.errors.negativeNumber;
      else if (shelfCheck === 'invalid' || !Number.isInteger(Number(draft.shelfLifeDays.trim()))) {
        errors.shelfLifeDays = s3.errors.shelfLifeInvalid;
      }
    }
  }

  return errors;
}
