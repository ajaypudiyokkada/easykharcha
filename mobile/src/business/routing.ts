import type { Business } from '../api/business';

const LAST_WIZARD_STEP = 6;

/** The wizard route to land on right after signing in. */
export function nextRouteAfterAuth(businesses: Business[]): string {
  if (businesses.length === 0) return '/setup/1';
  const incomplete = businesses.find((b) => !b.onboarding_completed_at);
  if (!incomplete) return '/home';

  // Once step 6 itself is done or skipped, onboarding_step stays at 6 (there's no step 7 slot) —
  // the per-step status is what actually says "the wizard itself is finished, just needs the
  // completion call", which only /setup/done makes.
  const step6 = incomplete.onboarding.find((step) => step.step === LAST_WIZARD_STEP);
  if (incomplete.onboarding_step >= LAST_WIZARD_STEP && step6 && step6.status !== 'todo') {
    return '/setup/done';
  }
  return `/setup/${incomplete.onboarding_step}`;
}

/** The business the wizard screens themselves are currently working on. Prefers one that's not yet
 * marked complete (the normal, fresh-onboarding case), so Back/Next updates that business instead
 * of creating a new one — but falls back to the first business otherwise, so Home's "Finish setting
 * up" card can still reopen a skipped step (via /setup/<n> directly) after onboarding is already
 * complete; without the fallback, that business would never match here again and every wizard
 * screen would redirect away as if no business existed at all. */
export function getOnboardingBusiness(businesses: Business[]): Business | undefined {
  return businesses.find((b) => !b.onboarding_completed_at) ?? businesses[0];
}
