import { strings } from '../strings';
import { findDuplicateName } from './groupItems';
import { validateOptionalNumber, validateRequiredNumber } from './validateNumber';
import type { StockItemDraft } from './StockItemForm';

const s3 = strings.setup.step3;

export type StockItemFieldErrors = {
  name?: string;
  unit?: string;
  usualPrice?: string;
  packSizeBaseQty?: string;
  shelfLifeDays?: string;
  lowStockDaysOverride?: string;
  lowStockFixedQty?: string;
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

  const packSizeCheck = validateOptionalNumber(draft.packSizeBaseQty);
  if (packSizeCheck === 'invalid') errors.packSizeBaseQty = s3.errors.invalidNumber;
  else if (packSizeCheck === 'negative') errors.packSizeBaseQty = s3.errors.packSizePositive;
  else if (draft.packSizeBaseQty.trim() && Number(draft.packSizeBaseQty.trim()) === 0) {
    errors.packSizeBaseQty = s3.errors.packSizePositive;
  }

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

  if (draft.lowStockDaysOverride.trim()) {
    const overrideCheck = validateRequiredNumber(draft.lowStockDaysOverride);
    if (overrideCheck === 'negative') errors.lowStockDaysOverride = s3.errors.negativeNumber;
    else if (
      overrideCheck === 'invalid' ||
      !Number.isInteger(Number(draft.lowStockDaysOverride.trim())) ||
      Number(draft.lowStockDaysOverride.trim()) < 1
    ) {
      errors.lowStockDaysOverride = s3.errors.shelfLifeInvalid;
    }
  }

  const fixedQtyCheck = validateOptionalNumber(draft.lowStockFixedQty);
  if (fixedQtyCheck === 'invalid') errors.lowStockFixedQty = s3.errors.invalidNumber;
  else if (fixedQtyCheck === 'negative') errors.lowStockFixedQty = s3.errors.negativeNumber;

  return errors;
}
