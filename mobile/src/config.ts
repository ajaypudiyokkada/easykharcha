/**
 * Links shown next to the signup consent checkbox. Left blank by default — the consent text is
 * still shown, just without a link, until these are set.
 */
export const links = {
  privacyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL ?? '',
  termsUrl: process.env.EXPO_PUBLIC_TERMS_URL ?? '',
} as const;
