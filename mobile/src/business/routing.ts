import type { Business } from '../api/business';
import { sectorCopyFor } from '../sectorCopy';

const LAST_WIZARD_STEP = 6;
// Step O1: the "How do you want to set up?" fork sits right after this step — resuming exactly
// here with no path chosen yet (menuScanEnabled sectors only) lands back on the fork, not step 2.
const FORK_AFTER_STEP = 2;
// Step O2: the quick path never shows "What you sell" (4) — the menu scan already created the
// dishes — so that slot is free to reuse as a marker, set only by menu-scan/ek.tsx's apply
// hand-off, meaning "EK setup just applied, the starting-stock count was offered next".
const QUICK_PATH_COUNT_PENDING_STEP = 4;

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
  if (incomplete.onboarding_step === FORK_AFTER_STEP) {
    if (incomplete.onboarding_path === 'quick') {
      // Step 4 only ever gets marked done/skipped once the whole menu-scan/EK detour is over (see
      // menu-scan/ek.tsx) — while it's still "todo", onboarding_step sitting at 2 means the detour
      // itself (scan, dish review, EK setup) hasn't finished, so resume there, not at brand.
      const detourDone = incomplete.onboarding.some(
        (step) => step.step === QUICK_PATH_COUNT_PENDING_STEP && step.status !== 'todo',
      );
      if (!detourDone) {
        return `/menu-scan?businessId=${incomplete.id}&returnTo=onboarding`;
      }
    } else if (
      !incomplete.onboarding_path &&
      sectorCopyFor(incomplete.business_type).menuScanEnabled
    ) {
      // Only intercepts right at the boundary — a business already further along (step 3+) with no
      // path saved is an existing owner mid-wizard from before this fork existed, who defaults to
      // the DIY path silently rather than being interrupted with it now.
      return '/setup/fork';
    }
  }
  if (
    incomplete.onboarding_path === 'quick' &&
    incomplete.onboarding_step === QUICK_PATH_COUNT_PENDING_STEP
  ) {
    return '/count';
  }
  return `/setup/${incomplete.onboarding_step}`;
}

/** Step O2: the quick path skips "What you buy" (3, shown only if EK setup failed and the owner
 * fell back to it) and always skips "What you sell" (4, its dishes already came from the menu
 * scan) — so its StepHeader shows an accurate shorter count instead of the DIY wizard's fixed 6. */
export function wizardStepDisplay(
  business: Business,
  step: number,
): { current: number; total: number } {
  if (business.onboarding_path !== 'quick') {
    return { current: step, total: LAST_WIZARD_STEP };
  }
  const sequence = step === 3 ? [1, 2, 3, 5, 6] : [1, 2, 5, 6];
  const index = sequence.indexOf(step);
  return { current: index >= 0 ? index + 1 : step, total: sequence.length };
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
