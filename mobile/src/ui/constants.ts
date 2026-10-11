/**
 * Component dimensions the approved UI kit specifies directly — distinct from `spacing` in
 * tokens.ts, which covers gaps, padding and margins, not fixed control chrome. Both numbers below
 * come straight from the kit's own CSS; neither is invented.
 */

/** `.btn{min-height:52px}` and `.input-wrap{min-height:52px}` in the kit. */
export const CONTROL_HEIGHT = 52;

/** `.progress{height:10px}` in the kit — StepHeader's progress track. */
export const PROGRESS_BAR_HEIGHT = 10;

/** Screen: "centres a column of at most 480px" on a wide window — Step 2's own wording. */
export const MAX_CONTENT_WIDTH = 480;
