/**
 * Links shown next to the signup consent checkbox. Left blank by default — the consent text is
 * still shown, just without a link, until these are set.
 */
export const links = {
  privacyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL ?? '',
  termsUrl: process.env.EXPO_PUBLIC_TERMS_URL ?? '',
  /** The public marketing site (landing/index.html) — web only; there's no equivalent on native, so
   * callers must guard with Platform.OS === 'web' before using this. */
  landingUrl: process.env.EXPO_PUBLIC_LANDING_URL ?? 'http://localhost:8082',
} as const;
