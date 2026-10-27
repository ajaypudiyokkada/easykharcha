export type AlertType =
  | 'opening_late'
  | 'closing_late'
  | 'price_rise'
  | 'wastage_high'
  | 'gap_flagged'
  | 'expiry_soon'
  | 'low_stock';
export type AlertSeverity = 'warning' | 'danger';

export type AlertNextAction = {
  label: string;
  route: string;
};

export type Alert = {
  key: string;
  type: AlertType;
  title: string;
  detail: string;
  severity: AlertSeverity;
  /** The figures behind the alert — field names vary by `type`, computed by the backend. */
  numbers: Record<string, string | number | null>;
  next_action: AlertNextAction;
};

export type AlertCounts = Record<AlertType, number> & { total: number };

export type AlertListResponse = {
  results: Alert[];
  counts: AlertCounts;
};
