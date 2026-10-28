export type ReportPeriod = 'today' | '7d' | '30d' | '90d';

export type ReportBucket = {
  start: string;
  end: string;
};

export type MoneyWentBucket = ReportBucket & {
  bought: string;
  wastage_value: string;
  gap_value: string;
};

export type MoneyWent = {
  buckets: MoneyWentBucket[];
  total: { bought: string; wastage_value: string; gap_value: string };
};

export type UsedVsExpectedItem = {
  stock_item: number;
  name: string;
  unit: string;
  used: string;
  expected: string;
  gap_qty: string;
  gap_value: string;
};

export type UsedVsExpected = {
  items: UsedVsExpectedItem[];
  total_gap_value: string;
};

export type QuantityByFamily = Record<
  string,
  { base_qty: string; display_qty: string; display_unit: string }
>;

export type WastageTrendBucket = ReportBucket & {
  value: string;
  quantity_by_family: QuantityByFamily;
};

export type WastageTrend = {
  buckets: WastageTrendBucket[];
  total: { value: string; quantity_by_family: QuantityByFamily };
  change_pct: string | null;
};

export type PricePoint = { date: string; unit_price: string };

export type PriceTrendItem = { id: number; name: string; pct_change: string | null };

export type PriceTrend = {
  item: { id: number; name: string; unit: string } | null;
  points: PricePoint[];
  pct_change: string | null;
  items: PriceTrendItem[];
};

export type SalesVsCostBucket = ReportBucket & { sales: string; cost: string };

export type SalesVsCost = {
  buckets: SalesVsCostBucket[];
  total: { sales: string; cost: string };
  cost_pct: string | null;
  target_cost_pct: string;
  coverage_pct: string | null;
};

export type BiggestGapsItem = {
  stock_item: number;
  name: string;
  quantity: string;
  unit: string;
  value: string;
};

export type BiggestGaps = {
  items: BiggestGapsItem[];
};

export type ReportsSummary = {
  period: ReportPeriod;
  money_went: MoneyWent;
  used_vs_expected: UsedVsExpected;
  wastage_trend: WastageTrend;
  price_trend: PriceTrend;
  sales_vs_cost: SalesVsCost;
  biggest_gaps: BiggestGaps;
  /** Step 45b1c2b (docs/BASES_PLAN.md sec 5, Decision 5): revenue-weighted, business-level —
   * Home's "Recipes cover X% of your sales" banner. null when there were no sales in the window. */
  recipe_coverage_pct: string | null;
};
