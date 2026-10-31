/** Step EK-4c-1: types for the EK setup run — `ai/ek_setup.py`'s `build_owner_result` shape, read
 * by `POST`/`GET businesses/<id>/ai/menu-scans/<scan_id>/ek-setup/`. Every quantity here already
 * arrives display-formatted (`display_qty`/`display_unit`, via the backend's own
 * `stock/units.py`); nothing here is cost, model or vendor related — never shown to the owner. */

export type EkSetupRunStatus = 'queued' | 'running' | 'done' | 'failed';

export type EkDishRef = {
  dish_id: number | null;
  name: string;
};

export type EkBestSeller = EkDishRef & {
  key: string;
  reason: string;
  preselected: boolean;
};

export type EkDisplayQty = {
  name: string;
  display_qty: string;
  display_unit: string;
};

export type EkBaseDish = EkDishRef & {
  portion_display: string;
};

export type EkBase = {
  key: string;
  name: string;
  kind: string;
  per_1000_formula: EkDisplayQty[];
  dishes: EkBaseDish[];
};

export type EkFamilyMember = EkDishRef & {
  main_item: string;
  qty_display: string;
};

export type EkFamilyBaseUse = {
  base: string;
  portion_display: string;
};

export type EkFamily = {
  key: string;
  name: string;
  members: EkFamilyMember[];
  bases_used: EkFamilyBaseUse[];
  other_ingredients: EkDisplayQty[];
};

/** `unit_family` is ai/matching.py's own vocabulary (`g`/`ml`/`pieces` — the ingredient's own
 * storage unit), not stock/units.py's weight/volume/count family name. */
export type EkIngredient = {
  key: string;
  name: string;
  unit_family: 'g' | 'ml' | 'pieces' | '';
  low_stock_category: string;
  matched_item_id: number | null;
  used_in: string[];
};

export type EkSetupResult = {
  best_sellers: EkBestSeller[];
  bases: EkBase[];
  families: EkFamily[];
  ingredients: EkIngredient[];
  estimate_note: string;
  incomplete: boolean;
  dishes_without_suggestion: EkDishRef[];
};

export type EkSetupRun = {
  id: number;
  status: EkSetupRunStatus;
  error_code?: string;
} & Partial<EkSetupResult>;
