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
  created_at: string;
};
