import type { BusinessTypeValue } from './constants/businessTypes';
import type { UnitValue } from './constants/units';
import rawSectorCopy from './sectorCopy.json';

/**
 * The one place sector-specific wording and unit choices live — every screen that varies its copy
 * by business type reads from here instead of hard-coding kitchen/restaurant words. Data lives in
 * sectorCopy.json (not inline) so scripts/check_sector_copy.py can check every non-food type for
 * stray food wording without parsing TypeScript.
 */
export type SectorCopy = {
  /** What the owner buys, singular/plural — "ingredient", "material", "supply"... */
  stockNoun: string;
  stockNounPlural: string;
  /** What the owner sells, singular/plural — "dish", "product", "stay or service"... */
  sellNoun: string;
  sellNounPlural: string;
  /** Heading + one-line help over the sell-item form's "main stock item" picker. */
  usesLabel: string;
  usesHelp: string;
  stockNamePlaceholder: string;
  stockGroupPlaceholder: string;
  /** Shown as quick-pick chips only until this business has its own groups to offer instead. */
  stockGroupSuggestions: string[];
  sellNamePlaceholder: string;
  sellGroupPlaceholder: string;
  /** Shown as quick-pick chips only until this business has its own sell-item groups to offer
   * instead — its own namespace from stockGroupSuggestions, e.g. "Starters"/"Main course". */
  sellGroupSuggestions: string[];
  /** Placeholder for the dish form's portion-label field, e.g. "1 plate" or "6 pieces". */
  sellPortionPlaceholder: string;
  /** Example items under the "Used in many items" toggle. */
  sharedToggleHelp: string;
  /** Ordered; shown as the first unit chips offered. The full unit list is always reachable via
   * "More units" so no owner is ever blocked by this list being incomplete. */
  allowedUnits: UnitValue[];
  defaultUnit: UnitValue;
  /** Whether "Add your own" shows the perishable toggle inline (true) or tucks it under "More
   * options", collapsed unless the item being edited already has it set (false). */
  goesOffDefault: boolean;
  goesOffQuestion: string;
  /** One-line help text used on the Count screen and under the wastage reason picker. */
  countHelp: string;
  wastageHelp: string;
  roleLabels: {
    headChef: string;
  };
};

const SECTOR_COPY = rawSectorCopy as unknown as Record<BusinessTypeValue, SectorCopy>;

export function sectorCopyFor(businessType: string): SectorCopy {
  return SECTOR_COPY[businessType as BusinessTypeValue] ?? SECTOR_COPY.other;
}

/** The setup wizard's "ingredients should cost about X%" hint — the only sector-varying string
 * built from the config rather than stored in it verbatim, since it's just stockNounPlural dropped
 * into one fixed sentence. */
export function targetCostHint(businessType: string): string {
  const { stockNounPlural } = sectorCopyFor(businessType);
  return `e.g. 30 means ${stockNounPlural} should cost about 30% of the selling price.`;
}
