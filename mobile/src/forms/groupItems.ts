export const UNGROUPED = 'Ungrouped';

export type GroupBucket<T> = { group: string; items: T[] };

/**
 * Groups a flat item list by its own `group` field — alphabetical, blank-group items last under
 * "Ungrouped". Groups are already canonicalised server-side (case-insensitive match against this
 * business's existing groups, see backend/stock/views.py's _canonical_group), so this is a plain
 * exact-match group-by, not another layer of fuzzy matching.
 */
export function groupItems<T extends { group: string }>(items: T[]): GroupBucket<T>[] {
  const byGroup = new Map<string, T[]>();
  for (const item of items) {
    const key = item.group || '';
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(item);
    else byGroup.set(key, [item]);
  }
  const named = [...byGroup.keys()].filter((key) => key !== '').sort((a, b) => a.localeCompare(b));
  const result: GroupBucket<T>[] = named.map((group) => ({ group, items: byGroup.get(group)! }));
  const ungrouped = byGroup.get('');
  if (ungrouped && ungrouped.length > 0) {
    result.push({ group: UNGROUPED, items: ungrouped });
  }
  return result;
}

/** Case/whitespace-insensitive match, for a client-side "You already have X" check before a save
 * round-trip even starts — the server re-checks this regardless (names can collide from two
 * devices at once), this is purely for a faster, friendlier message. */
export function findDuplicateName<T extends { name: string }>(
  items: T[],
  name: string,
): T | undefined {
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  return items.find((item) => item.name.trim().toLowerCase() === key);
}
