/** Step EK-4c-1: the owner's edits across the EK setup screens (batches, best sellers, and the
 * steps still to come), kept in one place so each screen reads/writes the same draft instead of
 * passing state through route params. Survives a page refresh via `localStorage`/`SecureStore`
 * (same platform split as `menuScanDraft.ts`), wrapped in try/catch — the server result (re-fetched
 * via the EK setup GET) is always the source of truth if storage is unavailable or stale.
 *
 * `buildApplyPayload` shapes the draft into EK-4b's apply format (`ai/ek_apply.py`). This step only
 * owns the batches ("bases") and best-sellers steps, so `recipes` here only carries which dishes
 * were picked — a later step fills in each one's `main`/`others`/`bases` ingredient lines before
 * apply is actually called. */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import type { EkBase, EkBestSeller, EkDishRef, EkIngredient, EkSetupResult } from '../api/ekSetup';
import { convertEntryQuantity, unitFamily, type UnitStockItem } from '../units';

export type EkBaseLineDraft = {
  id: string;
  /** null while a freshly-typed line hasn't been resolved to an ingredient key yet. */
  ingredientKey: string | null;
  name: string;
  amount: string;
  entryUnit: string;
};

export type EkBaseUsedInDish = {
  dishId: number | null;
  name: string;
  portion: string;
};

export type EkBaseDraft = {
  key: string;
  name: string;
  kind: string;
  keep: boolean;
  formula: EkBaseLineDraft[];
  dishes: EkBaseUsedInDish[];
};

export type EkBestSellerDraft = {
  key: string;
  dishId: number | null;
  name: string;
  reason: string;
  selected: boolean;
};

export type EkSetupDraft = {
  ingredients: EkIngredient[];
  bases: EkBaseDraft[];
  bestSellers: EkBestSellerDraft[];
  dishesWithoutSuggestion: EkDishRef[];
  estimateNote: string;
  /** Which of this step's two built screens (1 = batches, 2 = best sellers) the owner was on —
   * persisted so a page refresh resumes there instead of bouncing back to the first screen. */
  step: 1 | 2;
};

function keyFor(businessId: number, scanId: number): string {
  return `easykharcha.ek_setup_draft.${businessId}.${scanId}`;
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const ekSetupDraftStorage = {
  async load(businessId: number, scanId: number): Promise<EkSetupDraft | null> {
    try {
      const raw = await getItem(keyFor(businessId, scanId));
      if (!raw) return null;
      return JSON.parse(raw) as EkSetupDraft;
    } catch {
      return null;
    }
  },
  async save(businessId: number, scanId: number, draft: EkSetupDraft): Promise<void> {
    try {
      await setItem(keyFor(businessId, scanId), JSON.stringify(draft));
    } catch {
      // Best-effort only — a re-fetch of the run itself is always available as a fallback.
    }
  },
  async clear(businessId: number, scanId: number): Promise<void> {
    try {
      await removeItem(keyFor(businessId, scanId));
    } catch {
      // Nothing to do — worst case a stale draft lingers until overwritten next time.
    }
  },
};

let lineSeq = 0;
function nextLineId(): string {
  lineSeq += 1;
  return `ek-line-${Date.now()}-${lineSeq}`;
}

const SLUG_NON_WORD = /[^a-z0-9]+/g;

/** Mirrors `ai/ek_setup.py`'s `_slugify` closely enough for client-generated keys (a brand-new
 * ingredient/base the owner adds here) to never collide with the server's own slugs. */
export function slugify(text: string, used: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(SLUG_NON_WORD, '-')
      .replace(/^-+|-+$/g, '') || 'item';
  let slug = base;
  let suffix = 2;
  while (used.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(slug);
  return slug;
}

function normaliseName(name: string): string {
  return name.trim().toLowerCase();
}

/** Builds the initial draft from the EK setup run's own result — every line pre-filled with the
 * server's suggestion, nothing ticked off yet. */
export function draftFromResult(result: EkSetupResult): EkSetupDraft {
  const ingredientByName = new Map(result.ingredients.map((ing) => [normaliseName(ing.name), ing]));

  const bases: EkBaseDraft[] = result.bases.map((base: EkBase) => ({
    key: base.key,
    name: base.name,
    kind: base.kind,
    keep: true,
    formula: base.per_1000_formula.map((line) => ({
      id: nextLineId(),
      ingredientKey: ingredientByName.get(normaliseName(line.name))?.key ?? null,
      name: line.name,
      amount: line.display_qty,
      entryUnit: line.display_unit,
    })),
    dishes: base.dishes.map((dish) => {
      const [amount] = dish.portion_display.split(' ');
      return { dishId: dish.dish_id, name: dish.name, portion: amount ?? '' };
    }),
  }));

  const bestSellers: EkBestSellerDraft[] = result.best_sellers.map((pick: EkBestSeller) => ({
    key: pick.key,
    dishId: pick.dish_id,
    name: pick.name,
    reason: pick.reason,
    selected: pick.preselected,
  }));

  return {
    ingredients: result.ingredients,
    bases,
    bestSellers,
    dishesWithoutSuggestion: result.dishes_without_suggestion,
    estimateNote: result.estimate_note,
    step: 1,
  };
}

export function setStep(draft: EkSetupDraft, step: 1 | 2): EkSetupDraft {
  return { ...draft, step };
}

/** The fake "stock item" QuantityInput/units.ts need, built from an ingredient's own storage unit
 * (`g`/`ml`/`pieces` — ai/matching.py's vocabulary, never stock/units.py's weight/volume/count
 * family name). No pack sizes exist yet for an EK-suggested ingredient. */
export function unitStockItemFor(unit: string): UnitStockItem {
  const resolved = unit || 'g';
  return { unit: resolved, unit_family: unitFamily(resolved), pack_size_base_qty: null };
}

export function toggleBaseKeep(draft: EkSetupDraft, baseKey: string): EkSetupDraft {
  return {
    ...draft,
    bases: draft.bases.map((base) => (base.key === baseKey ? { ...base, keep: !base.keep } : base)),
  };
}

export function updateBaseLine(
  draft: EkSetupDraft,
  baseKey: string,
  lineId: string,
  patch: Partial<Pick<EkBaseLineDraft, 'amount' | 'entryUnit'>>,
): EkSetupDraft {
  return {
    ...draft,
    bases: draft.bases.map((base) =>
      base.key !== baseKey
        ? base
        : {
            ...base,
            formula: base.formula.map((line) =>
              line.id === lineId ? { ...line, ...patch } : line,
            ),
          },
    ),
  };
}

export function removeBaseLine(draft: EkSetupDraft, baseKey: string, lineId: string): EkSetupDraft {
  return {
    ...draft,
    bases: draft.bases.map((base) =>
      base.key !== baseKey
        ? base
        : { ...base, formula: base.formula.filter((line) => line.id !== lineId) },
    ),
  };
}

/** Adds a line from an ingredient already found on the menu (`ingredientKey` set) or a brand-new
 * typed name (`ingredientKey` null, `newName` set — a fresh ingredient is created in the draft too,
 * defaulting to grams, so it has a key to add further lines against right away). */
export function addBaseLine(
  draft: EkSetupDraft,
  baseKey: string,
  pick: { ingredientKey: string } | { newName: string },
): EkSetupDraft {
  let ingredients = draft.ingredients;
  let ingredientKey: string;
  let name: string;

  if ('ingredientKey' in pick) {
    const existing = ingredients.find((ing) => ing.key === pick.ingredientKey);
    ingredientKey = pick.ingredientKey;
    name = existing?.name ?? pick.ingredientKey;
  } else {
    const used = new Set(ingredients.map((ing) => ing.key));
    ingredientKey = slugify(pick.newName, used);
    name = pick.newName.trim();
    ingredients = [
      ...ingredients,
      {
        key: ingredientKey,
        name,
        unit_family: 'g',
        low_stock_category: 'dry_staples',
        matched_item_id: null,
        used_in: [],
      },
    ];
  }

  return {
    ...draft,
    ingredients,
    bases: draft.bases.map((base) =>
      base.key !== baseKey
        ? base
        : {
            ...base,
            formula: [
              ...base.formula,
              { id: nextLineId(), ingredientKey, name, amount: '', entryUnit: 'g' },
            ],
          },
    ),
  };
}

export function addCustomBase(draft: EkSetupDraft, name: string): EkSetupDraft {
  const used = new Set(draft.bases.map((base) => base.key));
  const key = slugify(name, used);
  const base: EkBaseDraft = {
    key,
    name: name.trim(),
    kind: '',
    keep: true,
    formula: [],
    dishes: [],
  };
  return { ...draft, bases: [...draft.bases, base] };
}

export function addUsedInDish(
  draft: EkSetupDraft,
  baseKey: string,
  dish: { dishId: number; name: string },
): EkSetupDraft {
  return {
    ...draft,
    bases: draft.bases.map((base) =>
      base.key !== baseKey
        ? base
        : {
            ...base,
            dishes: [...base.dishes, { dishId: dish.dishId, name: dish.name, portion: '' }],
          },
    ),
  };
}

export function removeUsedInDish(
  draft: EkSetupDraft,
  baseKey: string,
  dishId: number,
): EkSetupDraft {
  return {
    ...draft,
    bases: draft.bases.map((base) =>
      base.key !== baseKey
        ? base
        : { ...base, dishes: base.dishes.filter((dish) => dish.dishId !== dishId) },
    ),
  };
}

export function updateUsedInPortion(
  draft: EkSetupDraft,
  baseKey: string,
  dishId: number,
  portion: string,
): EkSetupDraft {
  return {
    ...draft,
    bases: draft.bases.map((base) =>
      base.key !== baseKey
        ? base
        : {
            ...base,
            dishes: base.dishes.map((dish) =>
              dish.dishId === dishId ? { ...dish, portion } : dish,
            ),
          },
    ),
  };
}

export function toggleBestSeller(draft: EkSetupDraft, key: string): EkSetupDraft {
  return {
    ...draft,
    bestSellers: draft.bestSellers.map((pick) =>
      pick.key === key ? { ...pick, selected: !pick.selected } : pick,
    ),
  };
}

export function addBestSeller(
  draft: EkSetupDraft,
  dish: { dishId: number; name: string },
): EkSetupDraft {
  if (draft.bestSellers.some((pick) => pick.dishId === dish.dishId)) return draft;
  const used = new Set(draft.bestSellers.map((pick) => pick.key));
  const key = slugify(dish.name, used);
  return {
    ...draft,
    bestSellers: [
      ...draft.bestSellers,
      { key, dishId: dish.dishId, name: dish.name, reason: '', selected: true },
    ],
  };
}

export type EkApplyPayload = {
  ingredients: {
    key: string;
    name: string;
    create: boolean;
    existing_item_id?: number;
    unit_family: string;
    low_stock_category: string;
  }[];
  bases: {
    key: string;
    name: string;
    keep: boolean;
    formula: { ingredient_key: string; qty_base_units: string }[];
  }[];
  recipes: { dish_id: number | null; selected: boolean }[];
};

/** Shapes the draft into EK-4b's apply format (`ai/ek_apply.py`'s `apply_ek_setup`). Only
 * ingredients a kept base's formula actually uses are included, matching rule A server-side. */
export function buildApplyPayload(draft: EkSetupDraft): EkApplyPayload {
  const ingredientsByKey = new Map(draft.ingredients.map((ing) => [ing.key, ing]));

  const keptBases = draft.bases.filter((base) => base.keep);
  const usedIngredientKeys = new Set<string>();
  for (const base of keptBases) {
    for (const line of base.formula) {
      if (line.ingredientKey) usedIngredientKeys.add(line.ingredientKey);
    }
  }

  const ingredients = [...usedIngredientKeys].map((key) => {
    const ing = ingredientsByKey.get(key);
    const payload: EkApplyPayload['ingredients'][number] = {
      key,
      name: ing?.name ?? key,
      create: !ing?.matched_item_id,
      unit_family: ing?.unit_family ?? 'g',
      low_stock_category: ing?.low_stock_category ?? '',
    };
    if (ing?.matched_item_id) payload.existing_item_id = ing.matched_item_id;
    return payload;
  });

  const bases = keptBases.map((base) => ({
    key: base.key,
    name: base.name,
    keep: true,
    formula: base.formula
      .filter((line): line is EkBaseLineDraft & { ingredientKey: string } =>
        Boolean(line.ingredientKey),
      )
      .map((line) => {
        const ing = ingredientsByKey.get(line.ingredientKey);
        const stockItem = unitStockItemFor(ing?.unit_family ?? 'g');
        const amount = Number(line.amount.replace(',', '.')) || 0;
        const baseUnits = convertEntryQuantity(amount, line.entryUnit, stockItem);
        return { ingredient_key: line.ingredientKey, qty_base_units: String(baseUnits) };
      }),
  }));

  const recipes = draft.bestSellers
    .filter((pick) => pick.selected)
    .map((pick) => ({ dish_id: pick.dishId, selected: true }));

  return { ingredients, bases, recipes };
}
