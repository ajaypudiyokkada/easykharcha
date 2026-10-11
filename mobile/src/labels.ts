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
