import type { Business } from '../api/business';

/** The wizard route to land on right after signing in. Only steps 1-2 exist — a business whose
 * onboarding_step has already passed that (or is complete) just goes home. */
export function nextRouteAfterAuth(businesses: Business[]): string {
  if (businesses.length === 0) return '/setup/1';
  const resuming = businesses.find((b) => !b.onboarding_completed_at && b.onboarding_step < 3);
  if (resuming) return `/setup/${resuming.onboarding_step}`;
  return '/home';
}

/** The business the wizard screens themselves are currently working on — the first one not yet
 * marked complete. Used so Back/Next within the wizard updates the same business instead of
 * creating a new one each time. */
export function getOnboardingBusiness(businesses: Business[]): Business | undefined {
  return businesses.find((b) => !b.onboarding_completed_at);
}
