/** `can(business.permissions, 'purchases.edit')` — hides what a screen shouldn't offer. This is for
 * neatness only; the server checks every permission again on every write, so there's no way to get
 * more access by hiding a button. */
export function can(permissions: string[], permission: string): boolean {
  return permissions.includes(permission);
}
