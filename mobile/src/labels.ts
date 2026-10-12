/**
 * Wording that changes by business type — kept separate from strings.ts because it's a function of
 * the business, not fixed copy. Used from step 4 onward; kept ready here for later screens too.
 */
export function sellItemLabel(businessType: string): string {
  switch (businessType) {
    case 'restaurant_cafe':
      return 'dish';
    case 'bakery_sweets':
      return 'product';
    case 'homestay':
      return 'service';
    default:
      return 'item you sell';
  }
}

// Business types where "runs the kitchen" is a literal, meaningful job — everywhere else, the same
// role is called "Team lead" instead.
const KITCHEN_BUSINESS_TYPES = new Set([
  'restaurant_cafe',
  'cloud_kitchen',
  'bakery_sweets',
  'tiffin_catering',
]);

export function headChefLabel(businessType: string): string {
  return KITCHEN_BUSINESS_TYPES.has(businessType) ? 'Head chef' : 'Team lead';
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
