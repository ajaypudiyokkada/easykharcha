import { strings } from '../strings';
import { findDuplicateName } from './groupItems';
import { validateRequiredNumber } from './validateNumber';
import type { SellItemDraft } from './SellItemForm';

const s4 = strings.setup.step4;

export type SellItemFieldErrors = {
  name?: string;
  price?: string;
};

/** Shared by setup/4's inline add form and Settings' SellItemSheet — see validateStockItem.ts's
 * own note, same reasoning. */
export function validateSellItemDraft(
  draft: SellItemDraft,
  existingItems: { name: string }[],
): SellItemFieldErrors {
  const errors: SellItemFieldErrors = {};

  const name = draft.name.trim();
  if (!name) {
    errors.name = s4.errors.nameRequired;
  } else if (name.length > 120) {
    errors.name = s4.errors.nameTooLong;
  } else {
    const dup = findDuplicateName(existingItems, name);
    if (dup) errors.name = s4.errors.duplicateName(dup.name);
  }

  const priceCheck = validateRequiredNumber(draft.sellingPrice);
  if (priceCheck === 'required') errors.price = s4.errors.priceRequired;
  else if (priceCheck === 'invalid') errors.price = s4.errors.invalidNumber;
  else if (priceCheck === 'negative') errors.price = s4.errors.negativeNumber;

  return errors;
}
