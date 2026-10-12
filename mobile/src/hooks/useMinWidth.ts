import { useWindowDimensions } from 'react-native';

/** True once the window is at least `breakpoint` wide — the min-width breakpoint check every
 * responsive layout decision in Step 8d is built from, mobile-first (narrow is the default, wider
 * layouts opt in). */
export function useMinWidth(breakpoint: number): boolean {
  const { width } = useWindowDimensions();
  return width >= breakpoint;
}
