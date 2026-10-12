export type OnboardingStepStatus = 'todo' | 'done' | 'skipped';

export type OnboardingStep = {
  step: number;
  status: OnboardingStepStatus;
};

export type Business = {
  id: number;
  name: string;
  business_type: string;
  city: string;
  tagline: string;
  primary_colour: string;
  logo: string | null;
  timezone: string;
  currency: string;
  onboarding_step: number;
  onboarding_completed_at: string | null;
  onboarding: OnboardingStep[];
  skipped_steps: number[];
  /** The signed-in user's own role on this business — not always Owner, now that team members can
   * log in too. Null only if the serializer had no request context (never happens via authedFetch). */
  role: string | null;
  checklist_dismissed_at: string | null;
  created_at: string;
};

export type BusinessSettings = {
  count_deadline_hour: number;
  target_cost_pct: string;
  wastage_alert_pct: string;
  rate_creep_pct: string;
};
