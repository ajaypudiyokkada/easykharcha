/** Mirrors backend/config/settings.py's BUSINESS_SETTINGS_DEFAULTS exactly — kept in sync by hand,
 * since a business already has these values the moment it's created; "Use recommended settings"
 * just re-asserts them. */
export const DEFAULT_BUSINESS_SETTINGS = {
  count_deadline_hour: 11,
  closing_count_hour: 20,
  target_cost_pct: 30,
  wastage_alert_pct: 5,
  rate_creep_pct: 10,
  gap_alert_pct: 10,
} as const;
