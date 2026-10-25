/** The build timestamp `scripts/patch_web_shell.mjs` stamps into `dist/index.html` and `dist/sw.js`
 * at export time — `undefined` under the Expo dev server, where no patch step ever runs. */
export function getBuildVersion(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as typeof window & { __EK_BUILD_VERSION__?: string }).__EK_BUILD_VERSION__;
}
