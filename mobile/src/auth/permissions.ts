/** `can(business.permissions, 'purchases.edit')` — hides what a screen shouldn't offer. This is for
 * neatness only; the server checks every permission again on every write, so there's no way to get
 * more access by hiding a button. */
export function can(permissions: string[], permission: string): boolean {
  return permissions.includes(permission);
}

/** Head chef and Helper have neither stock.view nor purchases.view — the one signal Home, the app
 * shell and the Wastage screen all use to tell "the full inner app" and "a two-job role" apart,
 * rather than checking a role name directly. */
export function isLimitedRole(permissions: string[]): boolean {
  return !can(permissions, 'stock.view') && !can(permissions, 'purchases.view');
}
