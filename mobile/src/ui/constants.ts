/**
 * Component dimensions the approved UI kit specifies directly — distinct from `spacing` in
 * tokens.ts, which covers gaps, padding and margins, not fixed control chrome. Both numbers below
 * come straight from the kit's own CSS; neither is invented.
 */

/** `.btn{min-height:52px}` and `.input-wrap{min-height:52px}` in the kit. */
export const CONTROL_HEIGHT = 52;

/** `.progress{height:10px}` in the kit — StepHeader's progress track. */
export const PROGRESS_BAR_HEIGHT = 10;

/** Screen's default content width — dev/kit and the 404 screen, which Step 8d's per-context widths
 * below don't otherwise cover. */
export const MAX_CONTENT_WIDTH = 480;

/** Step 8d: minimum touch target — every interactive element not already covered by `CONTROL_HEIGHT`
 * (chips, icon buttons, quiet text links) must reach at least this in both dimensions. */
export const MIN_TOUCH_TARGET = 44;

/** Step 8d: min-width breakpoints a layout can widen at — phone first, then progressively wider.
 * Matches the spec's own numbers; `WIZARD_ASIDE_BREAKPOINT` is the one explicitly called out as 1024
 * rather than the general triad. */
export const BREAKPOINT_TABLET = 600;
export const BREAKPOINT_DESKTOP = 900;
export const BREAKPOINT_WIDE = 1200;
export const WIZARD_ASIDE_BREAKPOINT = 1024;

/** Step 8d: per-context content widths — replacing one flat cap for every screen with the widths the
 * spec actually asks for. */
export const AUTH_CARD_WIDTH = 440;
export const WIZARD_CONTENT_WIDTH = 640;
export const WIZARD_ASIDE_WIDTH = 320;
export const HOME_CONTENT_WIDTH = 720;
