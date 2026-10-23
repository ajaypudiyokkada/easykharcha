export type MenuScanStatus = 'queued' | 'reading' | 'done' | 'failed';

export type MenuDishKind = 'dish' | 'addon';

export type ExtractedDish = {
  name: string;
  price: number | null;
  confidence: number;
  kind: MenuDishKind;
  note: string;
  variants: string[];
  /** True when a sell item with this (normalised) name already exists — ai/jobs.py sets this so
   * the review screen can skip it instead of creating a duplicate. */
  existing: boolean;
};

export type ExtractedSection = {
  name: string;
  dishes: ExtractedDish[];
};

export type MenuScanCreateResponse = {
  id: number;
  status: MenuScanStatus;
};

export type MenuScanDetail = {
  id: number;
  status: MenuScanStatus;
  is_menu?: boolean;
  sections?: ExtractedSection[];
  incomplete?: boolean;
  message?: string;
  error_code?: string;
};
