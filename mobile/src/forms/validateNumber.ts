/**
 * A plain-decimal check for price/quantity fields — catches the two things a numeric keyboard
 * won't stop someone from typing: a comma instead of a dot ("1,5"), and a leading minus. Returns
 * null for blank (callers decide if blank is allowed) or a valid plain decimal.
 */
export function validateOptionalNumber(raw: string): 'invalid' | 'negative' | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return null;
  if (/^-\d+(\.\d+)?$/.test(trimmed)) return 'negative';
  return 'invalid';
}

/** Same, but blank is itself a failure (field is required) — returns the same two codes plus
 * 'required'. */
export function validateRequiredNumber(raw: string): 'invalid' | 'negative' | 'required' | null {
  if (!raw.trim()) return 'required';
  return validateOptionalNumber(raw);
}
