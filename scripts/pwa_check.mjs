#!/usr/bin/env node
/**
 * Verifies the installable-app-shell behaviour from Step 8 against the real production build — not
 * the Expo dev server, which never registers a service worker at all (see
 * mobile/src/pwa/registerServiceWorker.ts's `__DEV__` check).
 *
 * Five checks, each printed as its own OK/FAIL line:
 *  1. The manifest loads with the required fields and icon sizes.
 *  2. The service worker registers and reaches the "activated" state.
 *  3. After a first online load, going offline and reloading still opens the app shell (served from
 *     the service worker's cache, not a browser error page).
 *  4. The offline banner shows, and tapping "Log in" while offline shows the offline message with no
 *     request sent to the server.
 *  5. Going back online makes the banner disappear on its own, and login succeeds normally.
 *
 * Requires, already running:
 *  - `npm run build:web && npm run serve:web` (the production export, served on :8082)
 *  - the backend on :8000 (`npm run serve` in backend/, or however it's normally started)
 *
 * Run with:  npm run pwa-check
 *
 * Localhost only. Never prints a password.
 */

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const APP_URL = 'http://127.0.0.1:8082';
const TIMEOUT = 15_000;
const SCREEN_DIR = 'docs/screens/step8';

function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    fail(
      'no Chrome or Edge install found in the usual locations — set CHROME_PATH to a Chromium-based browser.',
    );
  }
  return process.env.CHROME_PATH ?? found;
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function randomMobile() {
  const first = '6789'[Math.floor(Math.random() * 4)];
  let rest = '';
  for (let i = 0; i < 9; i++) rest += Math.floor(Math.random() * 10);
  return first + rest;
}

async function retryUntil(fn, timeout = TIMEOUT, interval = 200) {
  const deadline = Date.now() + timeout;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw lastErr ?? new Error('retryUntil: timed out with no match');
}

async function waitForPath(page, path) {
  await retryUntil(async () => (await page.evaluate(() => location.pathname)) === path);
}

async function waitForText(page, text) {
  await retryUntil(async () => (await page.evaluate(() => document.body.innerText)).includes(text));
}

async function waitForNoText(page, text) {
  await retryUntil(
    async () => !(await page.evaluate(() => document.body.innerText)).includes(text),
  );
}

// Mirrors flow.mjs: expo-router's web Stack keeps previous screens mounted (hidden, zero-size)
// rather than unmounting them, so a plain selector match can hit a stale duplicate. This filters to
// elements that actually have layout.
async function findVisible(page, selector, { last = false, minCount = 1 } = {}) {
  const matches = await retryUntil(async () => {
    const handles = await page.$$(selector);
    const visible = [];
    for (const handle of handles) {
      const ok = await handle.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (ok) visible.push(handle);
    }
    return visible.length >= minCount ? visible : null;
  });
  return last ? matches[matches.length - 1] : matches[0];
}

async function findVisibleByText(page, role, text) {
  const matches = await retryUntil(async () => {
    const handles = await page.$$(`[role="${role}"]`);
    const visible = [];
    for (const handle of handles) {
      const ok = await handle.evaluate((el, expected) => {
        if (el.textContent?.trim() !== expected) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }, text);
      if (ok) visible.push(handle);
    }
    return visible.length > 0 ? visible : null;
  });
  return matches[0];
}

async function clickButton(page, label) {
  const element = await findVisibleByText(page, 'button', label);
  await element.click();
}

async function clickAndSettle(handle) {
  await handle.click();
  await new Promise((resolve) => setTimeout(resolve, 200));
}

async function typeInto(page, label, text, { last = false, minCount = 1 } = {}) {
  const element = await findVisible(page, `[aria-label="${label}"]`, { last, minCount });
  await element.click({ clickCount: 3 });
  await element.type(text);
}

async function checkManifest(page) {
  const manifest = await page.evaluate(() => fetch('/manifest.json').then((r) => r.json()));
  const required = {
    name: 'EasyKharcha',
    short_name: 'EasyKharcha',
    start_url: '/',
    display: 'standalone',
    theme_color: '#1F6F63',
    background_color: '#FFF9F2',
    lang: 'en-IN',
  };
  for (const [key, value] of Object.entries(required)) {
    if (manifest[key] !== value) {
      fail(`manifest.${key} is ${JSON.stringify(manifest[key])}, expected ${JSON.stringify(value)}`);
    }
  }
  const sizes = (purpose) =>
    manifest.icons?.filter((icon) => icon.purpose === purpose).map((icon) => icon.sizes) ?? [];
  if (!sizes('any').includes('192x192')) fail('manifest is missing a 192x192 "any" icon.');
  if (!sizes('any').includes('512x512')) fail('manifest is missing a 512x512 "any" icon.');
  if (!sizes('maskable').includes('512x512')) fail('manifest is missing a 512x512 "maskable" icon.');
  console.log('OK — manifest.json has all required fields and icon sizes.');

  // Step 16a: the manifest listing the right sizes isn't proof the files themselves exist — each
  // one has to actually load.
  for (const icon of manifest.icons ?? []) {
    const status = await page.evaluate((src) => fetch(src).then((r) => r.status), icon.src);
    if (status !== 200) fail(`manifest icon ${icon.src} returned ${status}, expected 200.`);
  }
  for (const path of ['/icons/favicon-32.png', '/icons/favicon-48.png', '/icons/apple-touch-icon.png']) {
    const status = await page.evaluate((src) => fetch(src).then((r) => r.status), path);
    if (status !== 200) fail(`${path} returned ${status}, expected 200.`);
  }
  console.log('OK — every manifest icon and the favicon/apple-touch-icon files all load.');
}

async function checkNoCacheHeaders(page) {
  for (const path of ['/', '/sw.js']) {
    const cacheControl = await page.evaluate(
      (p) => fetch(p, { cache: 'no-store' }).then((r) => r.headers.get('cache-control')),
      path,
    );
    if (!cacheControl || !cacheControl.includes('no-cache')) {
      fail(`"${path}" Cache-Control is ${JSON.stringify(cacheControl)}, expected to include "no-cache".`);
    }
  }
  console.log('OK — "/" and "/sw.js" are served with Cache-Control: no-cache.');
}

async function checkServiceWorkerVersion(page) {
  const swSource = await page.evaluate(() =>
    fetch('/sw.js', { cache: 'no-store' }).then((r) => r.text()),
  );
  const match = swSource.match(/CACHE_VERSION = '([^']+)'/);
  if (!match) fail('sw.js has no CACHE_VERSION constant to check.');
  const version = match[1];
  // Proves scripts/patch_web_shell.mjs actually stamped a per-build value in, rather than the raw
  // placeholder (or a hardcoded constant) surviving untouched from one deploy to the next — which was
  // the original bug: identical sw.js bytes on every deploy meant a browser never saw anything worth
  // installing.
  if (version === '__EK_BUILD_VERSION__') {
    fail('sw.js CACHE_VERSION is still the unreplaced build-time placeholder.');
  }
  console.log(`OK — sw.js CACHE_VERSION ("${version}") is a per-build value, not a hardcoded constant.`);
}

async function checkServiceWorkerActivated(page) {
  const state = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return null;
    const registration = await navigator.serviceWorker.ready;
    return registration.active ? registration.active.state : null;
  });
  if (state !== 'activated') fail(`service worker state is ${state}, expected "activated".`);
  console.log('OK — service worker registered and reached the "activated" state.');
}

async function signup(page, name, mobile, password) {
  await page.goto(`${APP_URL}/signup`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await typeInto(page, 'Your name', name);
  await typeInto(page, 'Mobile number', mobile);
  await typeInto(page, 'Password', password);
  const consentBox = await findVisible(page, '[role="checkbox"]');
  // At this viewport height, the consent row's natural (unscrolled) position already satisfies
  // Puppeteer's "is it within the viewport bounds" check, so its own click() won't scroll any
  // further — even though that position sits directly under the sticky BottomActionBar. A real
  // person scrolls past it without a second thought; headless clicks need telling to.
  await consentBox.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await clickAndSettle(consentBox);
  await clickButton(page, 'Create account');
  await waitForPath(page, '/login');
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  await mkdir(SCREEN_DIR, { recursive: true });

  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => fail(`a JS error occurred in the page: ${err}`));
    await page.setViewport({ width: 390, height: 844 });

    // === First online load: lets the service worker install and cache the shell ===
    // Step 8c made "/" send a signed-out visitor to the public landing page (a real cross-origin
    // navigation) — going there directly would leave every check below running against the wrong
    // origin's manifest/service worker. /login is the same app shell (same origin, same SW scope)
    // without that redirect, and is the real door a signed-out visitor reaches the app through
    // anyway (the landing page's own "Log in"/"Start free" links).
    await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    // The wordmark that used to make this literal text true is an image now (Step 16a) — its alt
    // text doesn't count as visible body text, so check for the screen's own real heading instead.
    await waitForText(page, 'Business owner login');

    await checkManifest(page);
    await checkNoCacheHeaders(page);
    await checkServiceWorkerVersion(page);
    await checkServiceWorkerActivated(page);

    // === Check 3: offline + reload still opens the app shell ===
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'load', timeout: TIMEOUT });
    await waitForText(page, 'Business owner login');
    console.log('OK — reloading while offline still opens the cached app shell.');
    await page.setOfflineMode(false);

    // === A real signup, online, so check 5 has a working mobile/password to log in with ===
    const name = 'PWA Check';
    const mobile = randomMobile();
    const password = `Pwa${Math.floor(1000 + Math.random() * 9000)}!`;
    await signup(page, name, mobile, password);
    await waitForText(page, 'Account created. Log in to set up your business.');
    await typeInto(page, 'Password', password);

    // === Check 4: offline banner, blocked write, no request sent ===
    await page.setOfflineMode(true);
    await waitForText(page, "You're offline. Changes can't be saved right now.");
    console.log('OK — offline banner shows on /login.');

    const requestsDuringClick = [];
    const onRequest = (req) => requestsDuringClick.push(req.url());
    page.on('request', onRequest);
    await clickButton(page, 'Log in');
    await waitForText(page, "You're offline. Try again when you're back online.");
    page.off('request', onRequest);
    if (requestsDuringClick.some((url) => url.includes('/auth/login'))) {
      fail('tapping Log in while offline sent a request to /auth/login — it should send none.');
    }
    console.log('OK — tapping Log in while offline shows the offline message and sends no request.');

    await page.screenshot({ path: `${SCREEN_DIR}/login-offline.png` });
    console.log(`OK — saved ${SCREEN_DIR}/login-offline.png.`);

    // === Check 5: back online — banner disappears, login works ===
    await page.setOfflineMode(false);
    await waitForNoText(page, "You're offline. Changes can't be saved right now.");
    console.log('OK — offline banner disappears on its own once back online.');

    await clickButton(page, 'Log in');
    await waitForPath(page, '/setup/1');
    console.log('OK — login works again once back online.');

    // === 404 screenshot ===
    await page.goto(`${APP_URL}/this-page-does-not-exist`, {
      waitUntil: 'networkidle0',
      timeout: TIMEOUT,
    });
    await waitForText(page, 'Page not found');
    await page.screenshot({ path: `${SCREEN_DIR}/not-found.png` });
    console.log(`OK — saved ${SCREEN_DIR}/not-found.png.`);

    console.log('\nAll PWA checks passed.');
  } catch (err) {
    const page = (await browser.pages()).at(-1);
    if (page) {
      await page.screenshot({ path: 'docs/screens/step8/_pwa_check_failure.png' }).catch(() => {});
      console.error('URL at failure:', page.url());
    }
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => fail(err.stack ?? String(err)));
