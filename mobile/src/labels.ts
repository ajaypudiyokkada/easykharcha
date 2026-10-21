/**
 * Wording that changes by business type — kept separate from strings.ts because it's a function of
 * the business, not fixed copy. Thin wrappers over sectorCopy.ts, kept so existing call sites
 * (roleLabel, roleDescription) don't need to change.
 */
import { sectorCopyFor } from './sectorCopy';

export function sellItemLabel(businessType: string): string {
  return sectorCopyFor(businessType).sellNoun;
}

export function headChefLabel(businessType: string): string {
  return sectorCopyFor(businessType).roleLabels.headChef;
}

export type TeamRole = 'owner' | 'manager' | 'head_chef' | 'helper';

export function roleLabel(role: string, businessType: string): string {
  switch (role) {
    case 'owner':
      return 'Owner';
    case 'manager':
      return 'Manager';
    case 'head_chef':
      return headChefLabel(businessType);
    case 'helper':
      return 'Helper';
    default:
      return role;
  }
}

export function roleDescription(role: string): string {
  switch (role) {
    case 'helper':
      return 'Counts stock and records wastage.';
    case 'head_chef':
      return "Counts stock and sees today's numbers.";
    case 'manager':
      return 'Runs the day-to-day.';
    default:
      return '';
  }
}
