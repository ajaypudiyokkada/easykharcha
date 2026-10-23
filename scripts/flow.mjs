#!/usr/bin/env node
/**
 * Drives a real browser against the actual running app (not direct API calls, unlike smoke.py) to
 * prove the frontend and backend are wired together end to end.
 *
 * Starts with the root route, then four scenarios:
 *  0. Opening the app root ("/") signed out ends on the landing page (a real cross-origin
 *     navigation, not a route inside the app); its hero "Start free" button opens /signup.
 *  1. A fresh user: signup -> login -> all six wizard steps (step 2's colour preview checked live;
 *     step 5 adds a Helper with a PIN; step 6 uses the recommended settings) -> /setup/done (no
 *     "Still to do") -> /home (no "Finish setting up" card, onboarding is fully done) -> log out ->
 *     log in again -> lands on /home -> opening "/" again lands on /home too (signed in and
 *     onboarded, "/" never sends you to the landing page) -> logging out lands on /login.
 *  2. A second, independent user who stops after step 1, logs out mid-wizard, and logs back in to
 *     confirm they resume at /setup/2.
 *  3. A third, independent user who fills steps 1-2 then skips 3, 4, 5 and 6 — confirms /setup/done
 *     lists all four as "Still to do", /home's checklist card lists them too, and clicking Continue
 *     on one resumes that exact step.
 *  4. Logs in as the Helper created in scenario 1, using their PIN, and confirms /home has no
 *     checklist card and no setup links at all.
 *  5. Step 21b: a pincode (560034) fills in State and preselects City on /setup/1, an area is picked
 *     from its (small) areas list, the business saves, and reopening Settings -> Business profile
 *     shows the same pincode/state/city. A second, unknown pincode (999999) on that same screen shows
 *     "not found" and the "Enter city yourself" manual fallback.
 *
 * Run with:  npm run flow
 *
 * Requires the backend and the Expo web dev server already running (:8000 and :8081) and leaves them
 * running afterwards. Starts its own landing-page server on :8082 if nothing's already listening
 * there (closed again at the end) — see scripts/lib/landing_server.mjs. Localhost only. Never prints
 * a PIN or password — only pass/fail.
 */

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import puppeteer from 'puppeteer-core';

import { ensureLandingServer } from './lib/landing_server.mjs';

const APP_URL = 'http://localhost:8081';
// Must match mobile/src/config.ts's EXPO_PUBLIC_LANDING_URL default — the app itself decides where
// "/" sends a signed-out visitor, this just has to be listening wherever that actually points.
const LANDING_URL = 'http://localhost:8082';
const API_BASE = 'http://127.0.0.1:8000/api/v1';
const TIMEOUT = 15_000;
const SCREEN_DIR = 'docs/screens/step8c';
const STEP9_SCREEN_DIR = 'docs/screens/step9';
const STEP10_SCREEN_DIR = 'docs/screens/step10';
const STEP12_SCREEN_DIR = 'docs/screens/step12';
const STEP13_SCREEN_DIR = 'docs/screens/step13';
const STEP14_SCREEN_DIR = 'docs/screens/step14';
const STEP15_SCREEN_DIR = 'docs/screens/step15';
const STEP16_SCREEN_DIR = 'docs/screens/step16';
const STEP19_SCREEN_DIR = 'docs/screens/step19';
const STEP20_SCREEN_DIR = 'docs/screens/step20';
const STEP21B_SCREEN_DIR = 'docs/screens/step21b';
const STEP21D_SCREEN_DIR = 'docs/screens/step21d';
const STEP22A_SCREEN_DIR = 'docs/screens/step22a';
const STEP22A2_SCREEN_DIR = 'docs/screens/step22a2';
const STEP23A_SCREEN_DIR = 'docs/screens/step23a';
const STEP23B_SCREEN_DIR = 'docs/screens/step23b';
const STEP23D_SCREEN_DIR = 'docs/screens/step23d';
const STEP25C2A_SCREEN_DIR = 'docs/screens/step25c2a';
const STEP25C2A_FIXTURE_IMAGE = resolvePath('docs/images/ek_logo_icon.png');
// Step C2c: a 1-page PDF carrying the AI_FAKE-only FORCE_NEVER_FINISH marker (ai/views.py) — the
// scan it starts stays queued forever, used below to prove the Analyzing screen's stuck-scan UI.
// Must be a PDF, not a photo: a photo upload is always resized/re-encoded client-side before it
// reaches the backend, which would strip the marker bytes. Start the web dev server with
// EXPO_PUBLIC_MENU_SCAN_STUCK_AFTER_MS set small (e.g. 3000) to make the wait below fast.
const STEP25C2C_STUCK_FIXTURE_PDF = resolvePath('docs/images/menu_scan_force_never_finish.pdf');
// Covers the real 200-second default (STUCK_AFTER_MS=180_000 plus a buffer) when the dev server
// wasn't started with a shortened EXPO_PUBLIC_MENU_SCAN_STUCK_AFTER_MS.
const STEP25C2C_STUCK_WAIT_MS = 200_000;

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
  await retryUntil(async () =>
    (await page.evaluate(() => document.body.innerText)).includes(text),
  );
}

// expo-router's web Stack keeps previous screens mounted (hidden, zero-size) rather than
// unmounting them on navigation, so a plain selector/textContent match can silently hit a stale
// duplicate left over from an earlier screen. Everything below filters to elements that actually
// have layout (width/height > 0). Deliberately avoids page.waitForFunction returning a DOM node —
// that pattern hung intermittently on screens with many interactive elements; $$() plus a
// per-handle .evaluate() (returning only primitives) is the reliable version of the same idea.
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
    // Waits for at least `minCount` matches — without this, a field that only exists once a
    // sibling state update finishes mounting (e.g. a starter item's price box, revealed the instant
    // its checkbox is ticked) can get skipped entirely if checked before that render lands, silently
    // resolving to some *other*, already-present element with the same label instead.
    return visible.length >= minCount ? visible : null;
  });
  return last ? matches[matches.length - 1] : matches[0];
}

async function findVisibleByText(page, role, text, { last = false } = {}) {
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
  return last ? matches[matches.length - 1] : matches[0];
}

async function clickButton(page, label, { last = false } = {}) {
  const element = await findVisibleByText(page, 'button', label, { last });
  await element.click();
}

// A plain .click() resolves once the mouse events are dispatched, not once React has actually
// committed the resulting state update — moving straight on to the next action (e.g. clicking
// "Next" right after ticking a checkbox) can then race ahead of a selection that looks instant to a
// human but isn't synchronous here. react-native-web also doesn't reflect Pressable's
// accessibilityState.checked as a real aria-checked attribute in this version, so there's nothing
// in the DOM to poll for instead — a short fixed settle delay is the simple, reliable option.
async function clickAndSettle(handle) {
  await handle.click();
  await new Promise((resolve) => setTimeout(resolve, 200));
}

async function typeInto(page, label, text, { last = false, minCount = 1 } = {}) {
  const element = await findVisible(page, `[aria-label="${label}"]`, { last, minCount });
  await element.click({ clickCount: 3 });
  await element.type(text);
}

async function readValue(page, label) {
  const element = await findVisible(page, `[aria-label="${label}"]`);
  return element.evaluate((el) => el.value);
}

// Step F2: business name is asked once, here, at sign-up — the wizard's first step never asks
// again (it shows the name as a line with a Change link instead; see fillStepOne).
async function signup(page, name, mobile, password, businessName) {
  await page.goto(`${APP_URL}/signup`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await typeInto(page, 'Your name', name);
  await typeInto(page, 'Business name', businessName);
  await typeInto(page, 'Mobile number', mobile);
  await typeInto(page, 'Password', password);
  await clickAndSettle(await findVisible(page, '[role="checkbox"]'));
  await clickButton(page, 'Create account');
  await waitForPath(page, '/login');
}

async function login(page, mobile, secret) {
  await typeInto(page, 'Mobile number', mobile);
  await typeInto(page, 'Password', secret);
  await clickButton(page, 'Log in');
}

// Types a pincode into the PincodeLocationField and waits for its lookup to resolve (the "State"
// chip only renders once it has) before moving on — without this, a click racing ahead of the
// debounce + request could land before the City chips/State chip even exist yet.
async function fillPincodeLocation(page, pincode) {
  await typeInto(page, 'Pincode', pincode);
  await waitForText(page, 'State');
}

// Step F2: the business name is already shown (and editable via its own Change link) from the
// signup value — this step only fills in what signup doesn't ask for.
async function fillStepOne(page, pincode, typeLabel) {
  await fillPincodeLocation(page, pincode);
  await clickAndSettle(await findVisibleByText(page, 'radio', typeLabel));
  await clickButton(page, 'Next');
  await waitForPath(page, '/setup/2');
}

async function waitForPreviewColour(page, businessName, expectedHex) {
  await retryUntil(() =>
    page.evaluate(
      (name, hex) => {
        const target = hex
          .match(/#(..)(..)(..)/)
          .slice(1)
          .map((h) => parseInt(h, 16));
        // expo-router's web Stack keeps previous screens mounted (hidden, zero-size) rather than
        // unmounting them — Step F2's setup/1 now also shows the business name as plain text, so
        // an unfiltered match could land on that stale, zero-size copy instead of step 2's real,
        // visible preview. Same visibility filter findVisibleByText uses elsewhere in this file.
        const el = Array.from(document.querySelectorAll('*')).find((e) => {
          if (e.textContent?.trim() !== name || e.children.length !== 0) return false;
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (!el || !el.parentElement) return false;
        const bg = getComputedStyle(el.parentElement).backgroundColor;
        const match = bg.match(/rgb\((\d+), (\d+), (\d+)\)/);
        if (!match) return false;
        const [, r, g, b] = match.map(Number);
        return r === target[0] && g === target[1] && b === target[2];
      },
      businessName,
      expectedHex,
    ),
  );
}

// Signs the current user out via the profile sheet (Step 15: the only place Log out lives now)
// regardless of which screen they're actually on — needed between scenarios, since /login bounces a
// signed-in user straight to /home.
async function logoutFromAnywhere(page) {
  await page.goto(`${APP_URL}/home`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await clickAndSettle(await findVisible(page, '[aria-label="Open profile menu"]'));
  await clickButton(page, 'Log out');
  await waitForPath(page, '/login');
}

/** Pushes both count deadlines late in the day (direct API call, same trick used elsewhere in this
 * script and in responsive_check.mjs to force a count *late* by setting an hour to 0) — the
 * opposite adjustment, so neither the opening count this flow is about to submit nor the closing
 * count it hasn't submitted yet reads as already "late" regardless of what time of day this script
 * happens to run. Without it, checkOwnerOpeningCount's assertions that the opening count is "done"
 * and the closing one is still just "due by" a time would depend on running before 11 AM/8 PM.
 * day_starts_hour: 0 keeps the business date the plain calendar date too — otherwise, overnight
 * between midnight and the real default day_starts_hour (5), "today" would already be yesterday's
 * business date, whose 23:00 deadline has already passed (opening_required instead of "not late"). */
async function keepOpeningCountNotLate(page) {
  const access = await page.evaluate(() => localStorage.getItem('easykharcha.access'));
  const me = await fetch(`${API_BASE}/me/`, { headers: { Authorization: `Bearer ${access}` } }).then(
    (r) => r.json(),
  );
  const businessId = me.businesses[0].id;
  await fetch(`${API_BASE}/businesses/${businessId}/settings/`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ day_starts_hour: 0, count_deadline_hour: 23, closing_count_hour: 23 }),
  });
}

async function skipStep(page, fromStep, toPath) {
  await clickButton(page, 'Skip for now');
  await waitForPath(page, toPath);
  console.log(`OK — skipped step ${fromStep}.`);
}

// Step 8c's route-map proof: the landing page (hero) and /login (with its "Back to website" link),
// at a desktop and a phone width.
async function captureStep8cScreens(page) {
  for (const { width, height, suffix } of [
    { width: 1280, height: 900, suffix: '1280' },
    { width: 390, height: 844, suffix: '390' },
  ]) {
    await page.setViewport({ width, height });

    await page.goto(`${LANDING_URL}/`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await page.screenshot({ path: `${SCREEN_DIR}/landing-${suffix}.png` });

    await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await waitForText(page, 'Back to website');
    await page.screenshot({ path: `${SCREEN_DIR}/login-${suffix}.png` });
  }
  console.log(
    `OK — saved landing page and /login screenshots at 1280px and 390px to ${SCREEN_DIR}/.`,
  );
}

// "/" is the public front door now (Step 8c): a signed-out visitor is sent to the landing page, a
// full page navigation out of the app — not a route inside it, so this checks the real cross-origin
// hop rather than anything client-side-routable.
async function checkRootSignedOutToLanding(page) {
  await page.goto(`${APP_URL}/`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await retryUntil(async () => (await page.evaluate(() => location.href)).startsWith(LANDING_URL));
  console.log('OK — opening the app root signed out ends on the landing page.');

  await (await findVisible(page, '#heroSignupLink')).click();
  await retryUntil(async () => (await page.evaluate(() => location.href)).includes('/signup'));
  console.log('OK — the landing page\'s hero "Start free" button opens /signup.');
}

// Required screenshots at 390px and 1280px of Home, Buy, Record purchase, Purchase detail, Stock,
// and Stock item detail. Runs while the purchase created in checkPurchaseFlow still exists, since
// the detail routes need something real to show. "Record purchase" isn't its own route (it's a
// sheet), so it's recomposed fresh — filled in but never saved — purely for the screenshot.
async function captureStep9Screens(page, { purchasePath, stockItemPath }) {
  await mkdir(STEP9_SCREEN_DIR, { recursive: true });
  const routeShots = [
    { name: 'home', url: `${APP_URL}/home` },
    { name: 'buy', url: `${APP_URL}/buy` },
    { name: 'purchase-detail', url: `${APP_URL}${purchasePath}` },
    { name: 'stock', url: `${APP_URL}/stock` },
    { name: 'stock-item-detail', url: `${APP_URL}${stockItemPath}` },
  ];

  for (const width of [390, 1280]) {
    await page.setViewport({ width, height: 900 });

    for (const shot of routeShots) {
      await page.goto(shot.url, { waitUntil: 'networkidle0', timeout: TIMEOUT });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await page.screenshot({ path: `${STEP9_SCREEN_DIR}/${shot.name}-${width}.png` });
    }

    await page.goto(`${APP_URL}/buy`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await waitForText(page, 'Purchases');
    await clickButton(page, 'Record purchase');
    await waitForText(page, 'What did you buy?');
    await typeInto(page, 'Supplier', 'Sunrise Supplies');
    await clickAndSettle(await findVisibleByText(page, 'radio', 'Rice'));
    await typeInto(page, 'Quantity', '2');
    await typeInto(page, 'Price per unit', '40');
    await page.screenshot({ path: `${STEP9_SCREEN_DIR}/record-purchase-${width}.png` });
  }

  await page.setViewport({ width: 390, height: 3000 });
  console.log(`OK — saved Step 9 screenshots at 390px and 1280px to ${STEP9_SCREEN_DIR}/.`);
}

// Step 9: the signed-in Owner (already on /home, business fully set up with Rice/Cooking
// oil/Fresh Paneer from the wizard) records a two-line purchase, sees it in the Buy list, opens
// its detail, confirms the new price shows up on Stock item detail for one of the lines, then
// deletes the purchase via the confirmation dialog.
async function checkPurchaseFlow(page) {
  await page.goto(`${APP_URL}/buy`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Purchases');
  console.log('OK — /buy shows the Purchases screen.');

  await clickButton(page, 'Record purchase');
  await waitForText(page, 'What did you buy?');

  await typeInto(page, 'Supplier', 'Sunrise Supplies');

  await clickAndSettle(await findVisibleByText(page, 'radio', 'Rice'));
  await typeInto(page, 'Quantity', '2');
  await typeInto(page, 'Price per unit', '40');

  await clickButton(page, 'Add another item');
  await clickAndSettle(await findVisibleByText(page, 'radio', 'Cooking oil', { last: true }));
  await typeInto(page, 'Quantity', '1', { last: true });
  await typeInto(page, 'Price per unit', '60', { last: true });

  await clickButton(page, 'Save purchase');
  await waitForText(page, 'Purchase saved');
  console.log('OK — recorded a purchase with 2 lines; toast confirms the save.');

  await waitForText(page, 'Sunrise Supplies');
  console.log('OK — the new purchase appears in the Buy list.');

  await (await findVisible(page, '[aria-label="Sunrise Supplies"]')).click();
  await waitForText(page, 'Purchase detail');
  await waitForText(page, 'Rice');
  await waitForText(page, 'Cooking oil');
  console.log('OK — opened the purchase detail; both lines are shown.');
  const purchasePath = await page.evaluate(() => location.pathname);

  await page.goto(`${APP_URL}/stock`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Rice');
  await (await findVisible(page, '[aria-label="Rice"]')).click();
  await waitForText(page, 'Price trend');
  await waitForText(page, '₹40');
  console.log('OK — Stock item detail for Rice shows the new price point (last paid ₹40).');
  const stockItemPath = await page.evaluate(() => location.pathname);

  // Required screenshots, before the purchase above is deleted below.
  await captureStep9Screens(page, { purchasePath, stockItemPath });

  await page.goto(`${APP_URL}${purchasePath}`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Purchase detail');
  await clickButton(page, 'Delete purchase');
  await waitForText(page, 'Delete purchase?');
  await clickButton(page, 'Delete purchase', { last: true });
  await waitForPath(page, '/buy');
  const afterDeleteText = await page.evaluate(() => document.body.innerText);
  if (afterDeleteText.includes('Sunrise Supplies')) {
    fail('a deleted purchase should not still appear in the Buy list');
  }
  console.log(
    'OK — deleted the purchase via the confirmation dialog; it no longer appears in the list.',
  );
}

// Step 10: the signed-in Owner submits the opening stock count with plain values (no history yet,
// so no unusual-value guard is possible) — establishes the baseline the Helper's closing count
// below compares against.
async function checkOwnerOpeningCount(page) {
  await keepOpeningCountNotLate(page);

  // Step 23b: Today card screenshot before anything's been counted — opening due, closing locked.
  await mkdir(STEP23B_SCREEN_DIR, { recursive: true });
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${APP_URL}/home`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Stock count');
  await page.screenshot({ path: `${STEP23B_SCREEN_DIR}/today-opening-due-390.png` });

  await page.goto(`${APP_URL}/count`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  // Step 23d: this is the business's first count ever, framed as "Starting stock".
  await waitForText(page, 'Starting stock');
  await waitForText(page, 'This is your starting point.');
  await mkdir(STEP23D_SCREEN_DIR, { recursive: true });
  await page.screenshot({ path: `${STEP23D_SCREEN_DIR}/starting-stock-390.png` });
  console.log('OK — the first-ever count is framed as "Starting stock", with its own intro card.');

  // All three counted (not left partial) — the closing count below needs a baseline for every
  // item, including Fresh Paneer, to compute its own gap later in the flow; Save-with-partial-
  // items is covered by the smoke suite's own dedicated first-count check instead.
  await typeInto(page, 'Rice quantity', '5');
  await typeInto(page, 'Cooking oil quantity', '5');
  await typeInto(page, 'Fresh Paneer quantity', '5');
  await clickButton(page, 'Save count');
  await waitForText(page, 'Count saved. Thank you.');
  console.log('OK — the Owner submits the first-ever (opening) stock count.');

  await clickButton(page, 'Back to Today');
  await waitForPath(page, '/home');
  await waitForText(page, 'Stock count');
  console.log('OK — Home shows the stock count state card.');

  // Step 11 bug 1: the card used to read only the closing count's state — assert both the opening
  // count (just submitted, "done") and the closing count (not due yet) show up as separate lines.
  await waitForText(page, 'Opening count done');
  const bodyText = await page.evaluate(() => document.body.innerText);
  if (!bodyText.includes('Closing count due by')) {
    fail('Home\'s stock count card should also show the closing count\'s own state, not just the opening one');
  }

  // Step 23b: Today card screenshot once opening is done — closing is unlocked (due), not locked.
  await page.screenshot({ path: `${STEP23B_SCREEN_DIR}/today-closing-due-390.png` });
  console.log('OK — Home\'s stock count card shows both the opening and closing count states.');

  // Restores the 390x3000 viewport the rest of the flow already runs at (set by
  // captureStep9Screens just before this function runs) — this function's own 390x844 is only for
  // its own screenshots above.
  await page.setViewport({ width: 390, height: 3000 });
}

const FORBIDDEN_WORDS = ['₹', 'expected', 'gap', 'price'];

// Step 10: a Helper/Head chef page must never leak a rupee sign, "expected", "gap", or "price" —
// and never "usual" either, except inside the unusual-value guard dialog's own sentence.
async function assertNoForbiddenText(page, { allowUsual = false } = {}) {
  const text = (await page.evaluate(() => document.body.innerText)).toLowerCase();
  for (const word of FORBIDDEN_WORDS) {
    if (text.includes(word.toLowerCase())) {
      fail(`forbidden text "${word}" found on a Helper/Head chef page (${page.url()})`);
    }
  }
  if (!allowUsual && text.includes('usual')) {
    fail(`forbidden text "usual" found outside the guard dialog (${page.url()})`);
  }
}

// Step 15: Log out moved into the profile sheet for every role — Home itself must never show a
// standalone "Log out" button again.
async function assertNoStandaloneLogoutButton(page) {
  const bodyText = await page.evaluate(() => document.body.innerText);
  if (bodyText.includes('Log out')) {
    fail(`Home should have no standalone "Log out" button (${page.url()})`);
  }
}

// Step 10: the Helper signs in, sees the Today screen, submits the closing stock count (one value
// deliberately unusual against the Owner's opening baseline, exercising the confirm-guard), then
// records wastage and sees it under "My entries today".
async function checkHelperTodayFlow(page, helperMobile, helperPin) {
  await login(page, helperMobile, helperPin);
  await waitForPath(page, '/home');
  await waitForText(page, 'Good evening,');
  await assertNoForbiddenText(page);
  await assertNoStandaloneLogoutButton(page);
  console.log('OK — the Helper signs in and sees the Today screen.');

  await clickButton(page, 'Start closing count');
  await waitForPath(page, '/count');
  await waitForText(page, 'Count stock');
  await assertNoForbiddenText(page);
  // Step 23b: the Count screen itself, already routed straight to the closing form.
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: `${STEP23B_SCREEN_DIR}/count-screen-390.png` });

  // Rice: 50 is more than 3x the Owner's opening value of 5 -> needs_confirmation.
  await typeInto(page, 'Rice quantity', '50');
  await typeInto(page, 'Cooking oil quantity', '5');
  await typeInto(page, 'Fresh Paneer quantity', '5');
  await clickButton(page, 'Save count');
  await waitForText(page, 'That looks very different from usual.');
  await waitForText(page, 'Is 50 kg right?');
  await assertNoForbiddenText(page, { allowUsual: true });
  console.log('OK — count every item, then confirm one unusual value via the guard dialog.');

  await clickButton(page, 'Yes, 50 kg is right');
  await waitForText(page, 'Count saved. Thank you.');
  await assertNoForbiddenText(page);
  console.log('OK — confirming the unusual value saves the count; the Saved screen has no numbers.');

  await clickButton(page, 'Back to Today');
  await waitForPath(page, '/home');
  // Step 23b: both counts are done — the Today card's terminal state.
  await page.screenshot({ path: `${STEP23B_SCREEN_DIR}/today-both-done-390.png` });
  console.log(`OK — saved Step 23b Today card/Count screen screenshots to ${STEP23B_SCREEN_DIR}/.`);
  // Restores the 390x3000 viewport the rest of the flow runs at — the 390x844 above is only for
  // this function's own screenshots.
  await page.setViewport({ width: 390, height: 3000 });

  await (await findVisible(page, '[aria-label="Record wastage"]')).click();
  await waitForText(page, 'What was lost?');
  await assertNoForbiddenText(page);
  await clickAndSettle(await findVisibleByText(page, 'radio', 'Rice'));
  await typeInto(page, 'How much', '1');
  await clickButton(page, 'Save wastage');
  await waitForText(page, 'My entries today');
  await waitForText(page, 'Rice');
  await assertNoForbiddenText(page);
  console.log('OK — the Helper records wastage and sees it under "My entries today".');
}

// Step 10: the Head chef signs in and sees the team-wide Today screen — no counts/wastage numbers
// leak that a Helper or Head chef shouldn't see.
async function checkHeadChefTodayFlow(page, headChefMobile, headChefPin) {
  await login(page, headChefMobile, headChefPin);
  await waitForPath(page, '/home');
  await waitForText(page, 'Good evening,');
  await waitForText(page, 'Entries today');
  await assertNoForbiddenText(page);
  await assertNoStandaloneLogoutButton(page);
  console.log('OK — the Head chef signs in and sees the team Today screen.');
}

// Step 11 bug 2: a Manager used to see an ungated "Start stock count" action that returned 403 —
// Manager has no counts.create permission, so the button must not render at all.
async function checkManagerHomeFlow(page, managerMobile, managerPassword) {
  await login(page, managerMobile, managerPassword);
  await waitForPath(page, '/home');
  await waitForText(page, 'Quick actions');
  const bodyText = await page.evaluate(() => document.body.innerText);
  if (bodyText.includes('Start stock count')) {
    fail('a Manager should not see "Start stock count" on Home — they have no counts.create permission');
  }
  await assertNoStandaloneLogoutButton(page);
  console.log('OK — the Manager signs in and Home has no "Start stock count" button.');
}

// Step 10: back as Owner — count review lists both counts with a late/on-time chip, the closing
// count's detail shows the used-since-last-count numbers with the flagged item first, and the
// Wastage screen shows the Helper's entry with its rupee value before the Owner deletes it.
async function checkCountReviewAndWastageFlow(page, ownerMobile, ownerPassword) {
  await login(page, ownerMobile, ownerPassword);
  await waitForPath(page, '/home');

  // 390px screenshot of the More menu for the Owner — Sales, Wastage, Alerts, Team and Settings
  // should all be there (Count stock/Buy/Stock/Reports are primary bottom-nav items, not in More).
  // Done first, with nothing else open on the page, so there's no other sheet to race against.
  await mkdir(STEP23A_SCREEN_DIR, { recursive: true });
  await (await findVisible(page, '[aria-label="More"]')).click();
  await waitForText(page, 'Settings');
  // The sheet fades in (Modal animationType="fade") — same reason captureStep10Screens' Record
  // wastage screenshot needs a settle delay: screenshotting right on waitForText's heels catches it
  // mid-transition, semi-transparent over the page underneath.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.screenshot({ path: `${STEP23A_SCREEN_DIR}/more-menu-owner-390.png` });
  await (await findVisible(page, '[aria-label="Close"]')).click();
  console.log(`OK — saved the Owner's More menu screenshot to ${STEP23A_SCREEN_DIR}/.`);

  // Step 23a: Count stock and Wastage open for the Owner from Home's own quick actions, not just by
  // URL — the same "Start stock count"/"Record wastage" cards a Manager never sees (asserted in
  // checkManagerNoCountFlow below).
  await clickButton(page, 'Start stock count');
  await waitForPath(page, '/count');
  await waitForText(page, 'Count stock');
  await page.goto(`${APP_URL}/home`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForPath(page, '/home');
  await clickButton(page, 'Record wastage');
  await waitForText(page, 'Record wastage');
  await (await findVisible(page, '[aria-label="Close"]')).click();
  console.log('OK — the Owner opens Count stock and Wastage from Home.');

  await page.goto(`${APP_URL}/counts`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, "Today's counts");
  await waitForText(page, 'Opening count');
  await waitForText(page, 'Closing count');
  const reviewText = await page.evaluate(() => document.body.innerText);
  if (!reviewText.includes('On time') && !reviewText.includes('Late by')) {
    fail('count review: expected an On time or Late chip on each count');
  }
  console.log('OK — count review lists the opening and closing counts with a late/on-time chip.');

  await (await findVisible(page, '[aria-label="Closing count · Helper One"]')).click();
  await waitForText(page, 'Used since last count');
  await waitForText(page, 'Rice');
  console.log("OK — the closing count's detail shows the used-since-last-count numbers.");

  await page.goto(`${APP_URL}/wastage`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Wastage');
  await waitForText(page, 'Rice');
  const wastageText = await page.evaluate(() => document.body.innerText);
  if (!wastageText.includes('₹')) {
    fail('wastage: expected the Owner to see a rupee value on the entry');
  }
  console.log("OK — the Wastage screen shows the Helper's entry with its rupee value.");

  // Step 11 bug 3: the row's delete control is now a fixed-size icon button (fixed the one-char-
  // per-line wrap a full-width text Button caused in the row) — no text content, aria-label only.
  await clickAndSettle(await findVisible(page, '[aria-label="Delete entry"]'));
  await waitForText(page, 'Delete this entry?');
  await clickButton(page, 'Delete entry', { last: true });
  await waitForText(page, 'No wastage recorded yet.');
  console.log('OK — the Owner deletes the entry via the confirmation dialog.');
}

// Required screenshots at 390px and 1280px of: Helper Today, Blind count, Saved, Record wastage,
// Owner Home, Count review (list and detail), Wastage, Stock. Opening/closing counts and team
// roles are one-per-business-per-day, so this runs its own fresh business once per width rather
// than reusing the main flow's — the screens it needs to revisit mid-interaction (an open Record
// wastage sheet, a fresh Blind count form) can't be replayed afterwards on a business that's
// already used up today's two count slots.
async function captureStep10Screens(page) {
  await mkdir(STEP10_SCREEN_DIR, { recursive: true });

  for (const width of [390, 1280]) {
    await page.setViewport({ width, height: width === 390 ? 3000 : 1000 });

    const name = 'Shots Ten';
    const mobile = randomMobile();
    const password = `Flow${Math.floor(1000 + Math.random() * 9000)}!`;
    await signup(page, name, mobile, password, "Shots Ten's Kitchen");
    await login(page, mobile, password);
    await waitForPath(page, '/setup/1');
    await fillStepOne(page, '411001', 'Cloud kitchen');
    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/2');
    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/3');
    await waitForText(page, 'Pick from common items');
    await clickAndSettle(await findVisible(page, '[aria-label^="Groceries & dry goods ("]'));
    await clickAndSettle(await findVisible(page, '[aria-label="Rice. kg"]'));
    await clickButton(page, '1 selected — Next');
    await waitForPath(page, '/setup/4');
    await clickButton(page, 'Skip for now');
    await waitForPath(page, '/setup/5');

    const helperMobile = randomMobile();
    const helperPin = '7392';
    await typeInto(page, 'Name', 'Shots Helper');
    await typeInto(page, 'Mobile number', helperMobile);
    await clickAndSettle(await findVisibleByText(page, 'radio', 'Helper'));
    await typeInto(page, 'PIN', helperPin);
    await clickButton(page, 'Add person');
    await waitForText(page, 'Shots Helper');
    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/6');
    await clickButton(page, 'Use recommended settings');
    await waitForPath(page, '/setup/done');
    await clickButton(page, 'Go to Home');
    await waitForPath(page, '/home');
    await page.screenshot({ path: `${STEP10_SCREEN_DIR}/owner-home-${width}.png` });

    await keepOpeningCountNotLate(page);
    await page.goto(`${APP_URL}/count`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    // Step 23d: this business's first-ever count is framed as "Starting stock", not "Count stock".
    await waitForText(page, 'Starting stock');
    await typeInto(page, 'Rice quantity', '5');
    await clickButton(page, 'Save count');
    await waitForText(page, 'Count saved. Thank you.');
    await clickButton(page, 'Back to Today');
    await waitForPath(page, '/home');

    await page.goto(`${APP_URL}/stock`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await waitForText(page, 'Stock');
    await page.screenshot({ path: `${STEP10_SCREEN_DIR}/stock-${width}.png` });

    await page.goto(`${APP_URL}/wastage`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await waitForText(page, 'Wastage');
    await page.screenshot({ path: `${STEP10_SCREEN_DIR}/wastage-${width}.png` });

    await page.goto(`${APP_URL}/counts`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await waitForText(page, "Today's counts");
    await page.screenshot({ path: `${STEP10_SCREEN_DIR}/count-review-list-${width}.png` });
    await (await findVisible(page, '[aria-label="Opening count · Shots Ten"]')).click();
    await waitForText(page, 'Count detail');
    await page.screenshot({ path: `${STEP10_SCREEN_DIR}/count-review-detail-${width}.png` });

    await logoutFromAnywhere(page);
    await login(page, helperMobile, helperPin);
    await waitForPath(page, '/home');
    await waitForText(page, 'Good evening,');
    await page.screenshot({ path: `${STEP10_SCREEN_DIR}/helper-today-${width}.png` });

    await clickButton(page, 'Start closing count');
    await waitForPath(page, '/count');
    await waitForText(page, 'Count stock');
    await page.screenshot({ path: `${STEP10_SCREEN_DIR}/blind-count-${width}.png` });
    await typeInto(page, 'Rice quantity', '6');
    await clickButton(page, 'Save count');
    await waitForText(page, 'Count saved. Thank you.');
    await page.screenshot({ path: `${STEP10_SCREEN_DIR}/saved-${width}.png` });
    await clickButton(page, 'Back to Today');
    await waitForPath(page, '/home');

    await (await findVisible(page, '[aria-label="Record wastage"]')).click();
    await waitForText(page, 'What was lost?');
    // The sheet fades in (Modal animationType="fade") — the text exists in the DOM the instant it
    // mounts, well before the fade finishes, so a screenshot taken right on waitForText's heels
    // catches it mid-transition, semi-transparent over the page underneath.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.screenshot({ path: `${STEP10_SCREEN_DIR}/record-wastage-${width}.png` });
    await (await findVisible(page, '[aria-label="Close"]')).click();

    await logoutFromAnywhere(page);
  }

  // Back to the main flow's own tall-mobile viewport.
  await page.setViewport({ width: 390, height: 3000 });
  console.log(`OK — saved Step 10 screenshots at 390px and 1280px to ${STEP10_SCREEN_DIR}/.`);
}

// Step 12 settings + Step 22a dish recipes: Owner creates "Paneer Tikka" via "Add a dish" (portion,
// 3 ingredients incl. two added inline), edits it, then sees the plain-language message when trying
// to deactivate "Fresh Paneer" (stock) while that dish still uses it. Reuses "Veg biryani" (Step
// 22a2: the wizard's only remaining no-ingredients path, a ticked starter-pack item) to prove the
// dish list's "Needs ingredients" badge.
// The page is already signed in as the Owner from User 1's wizard data when this runs.
async function checkSettingsFlow(page) {
  await page.goto(`${APP_URL}/settings`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Settings');
  console.log('OK — Owner opens Settings.');

  await clickButton(page, 'What you sell');
  await waitForPath(page, '/settings/sell');
  await waitForText(page, 'Veg biryani');
  await waitForText(page, 'Needs ingredients');
  console.log(
    'OK — Settings -> What you sell lists the wizard-created dishes, badged "Needs ingredients".',
  );

  await mkdir(STEP22A_SCREEN_DIR, { recursive: true });
  await page.screenshot({ path: `${STEP22A_SCREEN_DIR}/dish-list-badges-390.png` });

  // === Step 22a: add a dish with a portion and 3 ingredients — one picked from the grouped list,
  // two added inline from inside the picker itself — then edit it ===
  // This business is "Cloud kitchen" — sectorCopy.json's sellNoun calls it "menu item", so that's
  // what the "Add {label}" button reads (the sheet's own title is the fixed "Add a dish" either way).
  await clickButton(page, 'Add menu item');
  await waitForText(page, 'Add a dish');
  await waitForText(page, '+ Add ingredient');
  // The sheet animates in — a short settle avoids catching it mid-fade, same as other sheet shots.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.screenshot({ path: `${STEP22A_SCREEN_DIR}/dish-form-empty-ingredients-390.png` });
  await page.setViewport({ width: 1280, height: 1000 });
  await page.screenshot({ path: `${STEP22A_SCREEN_DIR}/dish-form-empty-ingredients-1280.png` });
  await page.setViewport({ width: 390, height: 3000 });
  console.log('OK — "Add a dish" opens the dish form with its empty-ingredients state.');

  await typeInto(page, 'Name', 'Paneer Tikka', { last: true });
  await typeInto(page, 'Selling price', '180', { last: true });
  await typeInto(page, 'Portion (optional)', '1 plate', { last: true });

  await clickButton(page, '+ Add ingredient');
  await waitForText(page, 'Choose an item');
  await clickButton(page, 'Fresh Paneer');
  await typeInto(page, 'Amount', '0.300');
  console.log('OK — picked Fresh Paneer from the grouped ingredient list.');

  await clickButton(page, '+ Add ingredient');
  await waitForText(page, 'Choose an item');
  await clickButton(page, '+ Add a new item');
  await waitForText(page, 'Add a stock item');
  await typeInto(page, 'Name', 'Greek Yoghurt', { last: true });
  await clickAndSettle(await findVisibleByText(page, 'radio', 'kg', { last: true }));
  await clickButton(page, 'Add item');
  await waitForText(page, 'Greek Yoghurt');
  await typeInto(page, 'Amount', '0.100', { last: true, minCount: 2 });
  console.log('OK — added a second ingredient inline, from inside the picker itself.');

  await clickButton(page, '+ Add ingredient');
  await waitForText(page, 'Choose an item');
  await clickButton(page, '+ Add a new item');
  await waitForText(page, 'Add a stock item');
  await typeInto(page, 'Name', 'Mint Chutney', { last: true });
  await clickAndSettle(await findVisibleByText(page, 'radio', 'kg', { last: true }));
  await clickButton(page, 'Add item');
  await waitForText(page, 'Mint Chutney');
  await typeInto(page, 'Amount', '0.050', { last: true, minCount: 3 });
  console.log('OK — added a third ingredient inline too, proving the escape hatch isn\'t one-shot.');

  await page.screenshot({ path: `${STEP22A_SCREEN_DIR}/dish-form-390.png` });
  await page.setViewport({ width: 1280, height: 1600 });
  await page.screenshot({ path: `${STEP22A_SCREEN_DIR}/dish-form-1280.png` });
  await page.setViewport({ width: 390, height: 3000 });
  console.log(`OK — saved Step 22a screenshots to ${STEP22A_SCREEN_DIR}/.`);

  await clickButton(page, 'Save dish');
  await waitForText(page, 'Dish added');
  console.log('OK — saved the new dish with a portion and 3 ingredients; it appears at once.');

  // Edit it: drop one ingredient, keep the recipe confirmed with the remaining two.
  await (await findVisible(page, '[aria-label="Paneer Tikka"]')).click();
  await waitForText(page, 'Edit dish');
  await (await findVisible(page, '[aria-label="Remove Mint Chutney"]')).click();
  await clickButton(page, 'Save dish');
  await waitForText(page, 'Dish saved');
  console.log('OK — edited the dish, removing one ingredient; it saves with the remaining two.');

  await page.goto(`${APP_URL}/settings/stock`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'What you buy');
  await (await findVisible(page, '[aria-label="Fresh Paneer"]')).click();
  await waitForText(page, 'Edit stock item');
  await clickAndSettle(await findVisible(page, '[aria-label="Active"]'));
  await clickButton(page, 'Save item');
  await waitForText(page, "Can't deactivate");
  console.log(
    'OK — What you buy -> trying to deactivate a stock item a dish still uses shows the plain-language message.',
  );
}

// Step 13: Owner -> Team -> opens the Helper -> resets their PIN (toast) -> removes them from the
// team via the confirmation dialog -> the list updates. Run late in the flow, once nothing further
// depends on the wizard-created Helper still existing.
async function checkTeamManagementFlow(page, helperName) {
  await page.goto(`${APP_URL}/team`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Team');
  await waitForText(page, helperName);
  console.log('OK — Owner opens Team; the Helper is listed.');

  await (await findVisible(page, `[aria-label="${helperName}"]`)).click();
  await waitForText(page, 'Team member');
  await waitForText(page, helperName);
  console.log('OK — opened the Helper\'s member detail.');

  await clickButton(page, 'Reset PIN');
  await waitForText(page, 'Reset PIN?');
  await typeInto(page, 'New PIN', '4821');
  await clickButton(page, 'Reset PIN', { last: true });
  await waitForText(page, 'PIN reset');
  console.log('OK — reset the Helper\'s PIN; toast confirms the save.');

  await clickButton(page, 'Remove from team');
  await waitForText(page, `Remove ${helperName} from the team?`);
  await clickButton(page, 'Remove from team', { last: true });
  await waitForPath(page, '/team');
  const afterRemoveText = await page.evaluate(() => document.body.innerText);
  if (afterRemoveText.includes(helperName)) {
    fail(`${helperName} should no longer appear in the Team list after being removed`);
  }
  console.log('OK — removed the Helper via the confirmation dialog; the Team list updates.');
}

// Required screenshots at 390px only: Team list, Member detail, Reset PIN sheet, Remove dialog.
// Uses the Head chef (never removed anywhere else in this script) rather than the Helper above, so
// this has no ordering dependency on checkTeamManagementFlow — the Remove dialog is opened and
// then cancelled, purely for the screenshot.
async function captureStep13Screens(page, ownerMobile, ownerPassword, headChefName) {
  await mkdir(STEP13_SCREEN_DIR, { recursive: true });
  await page.setViewport({ width: 390, height: 3000 });

  // captureStep12Screens (run just before this) leaves the page signed in on /settings/alerts, not
  // on /login — log out first so `login()` below has the mobile/password fields to type into.
  await logoutFromAnywhere(page);
  await login(page, ownerMobile, ownerPassword);
  await waitForPath(page, '/home');

  await page.goto(`${APP_URL}/team`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Team');
  await waitForText(page, headChefName);
  await page.screenshot({ path: `${STEP13_SCREEN_DIR}/team-list-390.png` });

  await (await findVisible(page, `[aria-label="${headChefName}"]`)).click();
  await waitForText(page, 'Team member');
  await page.screenshot({ path: `${STEP13_SCREEN_DIR}/member-detail-390.png` });

  await clickButton(page, 'Reset PIN');
  await waitForText(page, 'Reset PIN?');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.screenshot({ path: `${STEP13_SCREEN_DIR}/reset-pin-sheet-390.png` });
  await (await findVisible(page, '[aria-label="Close"]')).click();

  await clickButton(page, 'Remove from team');
  await waitForText(page, `Remove ${headChefName} from the team?`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.screenshot({ path: `${STEP13_SCREEN_DIR}/remove-dialog-390.png` });
  await clickButton(page, 'Keep them');

  console.log(`OK — saved Step 13 screenshots at 390px to ${STEP13_SCREEN_DIR}/.`);
}

// Required screenshots at 390px only: Settings hub, What you buy, edit sheet, Alert rules.
async function captureStep12Screens(page, ownerMobile, ownerPassword) {
  await mkdir(STEP12_SCREEN_DIR, { recursive: true });
  await page.setViewport({ width: 390, height: 3000 });

  await login(page, ownerMobile, ownerPassword);
  await waitForPath(page, '/home');

  await page.goto(`${APP_URL}/settings`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Settings');
  await page.screenshot({ path: `${STEP12_SCREEN_DIR}/settings-hub-390.png` });

  // Step 18: the "Expiry alerts" row is a real setting now, not a disabled "Coming soon" row.
  const expiryRowText = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Expiry alerts"]');
    return el ? el.innerText : null;
  });
  if (!expiryRowText || expiryRowText.includes('Coming soon')) {
    fail(`settings hub: expected "Expiry alerts" to be a real row, got ${JSON.stringify(expiryRowText)}`);
  }
  console.log('OK — Step 18: the Settings hub\'s "Expiry alerts" row is no longer "Coming soon".');

  await page.goto(`${APP_URL}/settings/stock`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'What you buy');
  await page.screenshot({ path: `${STEP12_SCREEN_DIR}/what-you-buy-390.png` });

  await (await findVisible(page, '[aria-label="Fresh Paneer"]')).click();
  await waitForText(page, 'Edit stock item');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.screenshot({ path: `${STEP12_SCREEN_DIR}/edit-sheet-390.png` });
  await (await findVisible(page, '[aria-label="Close"]')).click();

  await page.goto(`${APP_URL}/settings/alerts`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Alert rules');
  await waitForText(page, 'Expiry warning (days ahead)');
  await page.screenshot({ path: `${STEP12_SCREEN_DIR}/alert-rules-390.png` });

  // Step 18: the expiry-warning-days field saves along with the rest of Alert rules — the same
  // settings row the Settings hub's "Expiry alerts" row now links to.
  await typeInto(page, 'Expiry warning (days ahead)', '3');
  await clickButton(page, 'Save rules');
  await waitForText(page, 'Alert rules saved');
  console.log('OK — Step 18: the expiry warning days field saves with the other alert settings.');

  console.log(`OK — saved Step 12 screenshots at 390px to ${STEP12_SCREEN_DIR}/.`);
}

// Step 14: Owner records sales for two dishes (Paneer Tikka, whose confirmed recipe checkSettingsFlow
// gave 0.300 kg of Fresh Paneer; Veg biryani, a no-ingredients dish) -> the list and summary update ->
// the closing count's gap for Fresh Paneer is flagged (nothing sold explains all of it) while Rice's
// is not_comparable (nothing sells it at all) -> required screenshots -> deletes one sale via the
// confirmation dialog.
async function checkSalesFlow(page) {
  await page.goto(`${APP_URL}/sales`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Sales');
  console.log('OK — /sales shows the Sales screen.');

  await clickButton(page, 'Record sales');
  await waitForText(page, 'What did you sell?');

  await clickAndSettle(await findVisibleByText(page, 'radio', 'Paneer Tikka'));
  await typeInto(page, 'How many', '2');

  await clickButton(page, 'Add another item');
  await clickAndSettle(await findVisibleByText(page, 'radio', 'Veg biryani', { last: true }));
  await typeInto(page, 'How many', '1', { last: true });

  await clickButton(page, 'Save sales');
  await waitForText(page, 'Sales saved');
  console.log('OK — recorded sales with 2 lines (Paneer Tikka, Veg biryani); toast confirms the save.');

  await waitForText(page, 'Paneer Tikka');
  await waitForText(page, 'Veg biryani');
  const salesText = await page.evaluate(() => document.body.innerText);
  if (!salesText.includes('Sales today')) {
    fail('sales: expected the "Sales today" summary card after recording sales');
  }
  console.log('OK — the new sales appear in the list and the summary updates.');

  await page.goto(`${APP_URL}/counts`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, "Today's counts");
  await (await findVisible(page, '[aria-label="Closing count · Helper One"]')).click();
  await waitForText(page, 'Count detail');
  await waitForText(page, 'Expected used');
  const detailText = await page.evaluate(() => document.body.innerText);
  if (!detailText.toLowerCase().includes('gap')) {
    fail('count review detail: expected a flagged gap for Fresh Paneer');
  }
  if (!detailText.includes('Nothing sold tracks this item yet.')) {
    fail('count review detail: expected a not_comparable reason for an item nothing sells (Rice)');
  }
  console.log('OK — count review shows expected used, a flagged gap, and a not_comparable reason.');

  await captureStep14Screens(page);

  await page.goto(`${APP_URL}/sales`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Sales');
  await clickAndSettle(await findVisible(page, '[aria-label="Delete entry"]'));
  await waitForText(page, 'Delete sales entry?');
  await clickButton(page, 'Delete entry', { last: true });
  await waitForText(page, 'Sales entry deleted');
  console.log('OK — deleted a sale via the confirmation dialog.');
}

// Required screenshots at 390px only: Sales, Record sales, Count review detail (flagged gap +
// not_comparable row), Home. Run from inside checkSalesFlow, before the sale it just recorded is
// deleted, same ordering checkPurchaseFlow/captureStep9Screens already uses.
async function captureStep14Screens(page) {
  await mkdir(STEP14_SCREEN_DIR, { recursive: true });
  await page.setViewport({ width: 390, height: 3000 });

  // Waits for content that only renders once its data has actually loaded — not the static heading,
  // which mounts immediately and would let the screenshot race the fetch and catch the skeleton.
  await page.goto(`${APP_URL}/sales`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Veg biryani');
  await page.screenshot({ path: `${STEP14_SCREEN_DIR}/sales-390.png` });

  await clickButton(page, 'Record sales');
  await waitForText(page, 'What did you sell?');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.screenshot({ path: `${STEP14_SCREEN_DIR}/record-sales-390.png` });
  await (await findVisible(page, '[aria-label="Close"]')).click();

  await page.goto(`${APP_URL}/counts`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, "Today's counts");
  await (await findVisible(page, '[aria-label="Closing count · Helper One"]')).click();
  await waitForText(page, 'Expected used');
  await page.screenshot({ path: `${STEP14_SCREEN_DIR}/count-review-detail-390.png` });

  await page.goto(`${APP_URL}/home`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Quick actions');
  await page.screenshot({ path: `${STEP14_SCREEN_DIR}/home-390.png` });

  console.log(`OK — saved Step 14 screenshots at 390px to ${STEP14_SCREEN_DIR}/.`);
}

// Step 15: Home's real "Needs attention" (the flagged Fresh Paneer gap checkSalesFlow just proved
// exists) -> its alert detail -> the primary action lands on Count review detail -> back -> "Mark
// as checked" -> the Alerts list updates -> the profile sheet (avatar) -> Log out -> /login.
async function checkAlertsAndProfileFlow(page, ownerName) {
  await page.setViewport({ width: 390, height: 3000 });
  await mkdir(STEP15_SCREEN_DIR, { recursive: true });

  await page.goto(`${APP_URL}/home`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Needs attention');
  await waitForText(page, 'Fresh Paneer has an unexplained gap');
  await assertNoStandaloneLogoutButton(page);
  await page.screenshot({ path: `${STEP15_SCREEN_DIR}/home-390.png` });
  console.log('OK — Home shows "Needs attention" with a real alert, and no standalone Log out button.');

  await (await findVisible(page, '[aria-label="Fresh Paneer has an unexplained gap"]')).click();
  await waitForText(page, 'Fresh Paneer has an unexplained gap');
  await waitForText(page, 'Review count');
  await page.screenshot({ path: `${STEP15_SCREEN_DIR}/alert-detail-390.png` });
  console.log('OK — tapping the alert opens its detail, with a "Review count" primary action.');

  await clickButton(page, 'Review count');
  await waitForText(page, 'Count detail');
  console.log('OK — the primary action lands on Count review detail.');

  await page.goBack({ waitUntil: 'networkidle0' });
  await waitForText(page, 'Fresh Paneer has an unexplained gap');
  await waitForText(page, 'Mark as checked');
  console.log('OK — back lands on the alert detail again.');

  await clickButton(page, 'Mark as checked');
  await waitForText(page, 'Marked as checked');
  await waitForPath(page, '/alerts');
  await page.screenshot({ path: `${STEP15_SCREEN_DIR}/alerts-390.png` });
  console.log('OK — marking it checked shows a toast and returns to the Alerts list.');

  const alertsText = await page.evaluate(() => document.body.innerText);
  if (alertsText.includes('Fresh Paneer has an unexplained gap')) {
    fail('a checked alert should no longer appear in the Alerts list');
  }
  console.log('OK — the checked alert no longer appears in the list.');

  // Step 18: the new expiry_soon type is wired into the filter row even with zero of them in this
  // business's data — alerts-390.png above already shows it, no separate screenshot needed.
  if (!alertsText.includes('Expiry 0')) {
    fail(`alerts: expected an "Expiry 0" filter chip (Step 18), got: ${alertsText}`);
  }
  console.log('OK — Step 18: the Alerts screen\'s filter row includes "Expiry".');

  await clickAndSettle(await findVisible(page, '[aria-label="Open profile menu"]'));
  await waitForText(page, 'Profile');
  await waitForText(page, ownerName);
  await page.screenshot({ path: `${STEP15_SCREEN_DIR}/profile-sheet-390.png` });
  console.log("OK — the avatar opens the profile sheet with the signed-in user's name.");

  await clickButton(page, 'Log out');
  await waitForPath(page, '/login');
  console.log('OK — Log out from the profile sheet lands on /login.');
}

/** Seeds a "Flour" stock item with two purchases at different prices (direct API call, same trick
 * keepOpeningCountNotLate already uses) so Reports' price-trend picker has a second item to pick
 * beyond whatever Fresh Paneer/Rice history already exists in this business. */
async function seedFlourPriceHistory(page) {
  const access = await page.evaluate(() => localStorage.getItem('easykharcha.access'));
  const me = await fetch(`${API_BASE}/me/`, {
    headers: { Authorization: `Bearer ${access}` },
  }).then((r) => r.json());
  const businessId = me.businesses[0].id;
  const headers = { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' };

  const stockRes = await fetch(`${API_BASE}/businesses/${businessId}/stock-items/bulk/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ items: [{ name: 'Flour', unit: 'kg' }] }),
  }).then((r) => r.json());
  const flourId = stockRes[0].id;

  for (const unitPrice of ['60', '70']) {
    await fetch(`${API_BASE}/businesses/${businessId}/purchases/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        supplier_name: 'Mill Co',
        purchase_date_time: new Date().toISOString(),
        lines: [
          {
            stock_item: flourId,
            quantity: '10',
            unit_price: unitPrice,
            line_total: String(Number(unitPrice) * 10),
          },
        ],
      }),
    });
  }
}

// Step 16: Owner -> Reports -> switch to 30 days -> charts update -> "View as table" on one chart
// -> pick Flour in the price-trend chart's picker -> its "Open Flour" button lands on Flour's own
// Stock item detail.
async function checkReportsFlow(page) {
  await seedFlourPriceHistory(page);

  await page.goto(`${APP_URL}/reports`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Reports');
  await waitForText(page, 'Where money went');
  console.log('OK — Reports loads with real charts (period defaults to 7 days).');

  await clickButton(page, '30 days');
  await waitForText(page, 'Where money went');
  console.log('OK — switching to 30 days re-renders the charts.');

  await clickButton(page, 'View as table');
  await waitForText(page, 'View as chart');
  console.log('OK — "View as table" switches a chart to its table view.');

  await clickButton(page, 'Flour');
  await waitForText(page, 'Open Flour');
  console.log('OK — picking Flour in the price-trend chart shows its "Open Flour" button.');

  await clickButton(page, 'Open Flour');
  await waitForText(page, 'Flour');
  await waitForText(page, 'Price trend');
  console.log('OK — "Open Flour" lands on Flour\'s Stock item detail.');
}

async function captureStep16Screens(page) {
  await mkdir(STEP16_SCREEN_DIR, { recursive: true });
  for (const width of [390, 1280]) {
    await page.setViewport({ width, height: width === 390 ? 3000 : 1200 });
    await page.goto(`${APP_URL}/reports`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await waitForText(page, 'Where money went');
    await page.screenshot({ path: `${STEP16_SCREEN_DIR}/reports-${width}.png` });
  }
  await page.setViewport({ width: 390, height: 3000 });
  console.log(`OK — saved Step 16 screenshots at 390px and 1280px to ${STEP16_SCREEN_DIR}/.`);
}

// Step 16: a brand-new business (no purchases, counts or sales at all) sees every Reports card as
// a single empty state with one button, never a crash.
async function checkReportsEmptyStateFlow(page) {
  const name = 'Reports Empty Owner';
  const mobile = randomMobile();
  const password = `Flow${Math.floor(1000 + Math.random() * 9000)}!`;

  await signup(page, name, mobile, password, 'Empty Reports Biz');
  await login(page, mobile, password);
  await waitForPath(page, '/setup/1');
  await fillStepOne(page, '411001', 'Cloud kitchen');
  await clickButton(page, 'Next');
  await waitForPath(page, '/setup/3');

  await skipStep(page, 3, '/setup/4');
  await skipStep(page, 4, '/setup/5');
  await skipStep(page, 5, '/setup/6');
  await skipStep(page, 6, '/setup/done');
  await clickButton(page, 'Go to Home');
  await waitForPath(page, '/home');

  await page.setViewport({ width: 390, height: 3000 });
  await page.goto(`${APP_URL}/reports`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Reports');
  await waitForText(page, '7 days');
  await waitForText(page, 'Reports will appear after you record purchases, stock counts and sales.');
  await waitForText(page, 'Record purchase');
  console.log('OK — a brand-new business sees the Reports empty state with one button, no crash.');

  await mkdir(STEP16_SCREEN_DIR, { recursive: true });
  await page.screenshot({ path: `${STEP16_SCREEN_DIR}/reports-empty-390.png` });

  await logoutFromAnywhere(page);
}

// Step 21b: pincode -> State/City autofill, picking from a (small, <=8, no search needed) areas
// list, saving, and reopening Settings -> Business profile to see the same values — plus the three
// 390px states Light checks asks for: empty, found, and not-found/manual.
async function checkPincodeLocationFlow(page) {
  await mkdir(STEP21B_SCREEN_DIR, { recursive: true });
  const name = 'Pincode Flow Owner';
  const mobile = randomMobile();
  const password = `Flow${Math.floor(1000 + Math.random() * 9000)}!`;

  await signup(page, name, mobile, password, 'Koramangala Kitchen');
  await login(page, mobile, password);
  await waitForPath(page, '/setup/1');

  await page.setViewport({ width: 390, height: 3000 });
  await page.screenshot({ path: `${STEP21B_SCREEN_DIR}/pincode-empty-390.png` });

  await fillPincodeLocation(page, '560034');
  await waitForText(page, 'Karnataka');
  await page.screenshot({ path: `${STEP21B_SCREEN_DIR}/pincode-found-390.png` });
  console.log('OK — a valid pincode fills in State and preselects City.');

  await clickAndSettle(await findVisible(page, '[aria-label="Area (optional)"]'));
  await waitForText(page, "St. John's Medical College");
  await clickAndSettle(await findVisibleByText(page, 'radio', 'Koramangala'));
  console.log("OK — the Area picker lists this pincode's areas, and a choice can be made.");

  await clickAndSettle(await findVisibleByText(page, 'radio', 'Cloud kitchen'));
  await clickButton(page, 'Next');
  await waitForPath(page, '/setup/2');
  console.log('OK — the business saves with the picked pincode/city/state.');

  // Finish the wizard (nothing else here is under test) so Settings' Business profile is reachable.
  await clickAndSettle(await findVisible(page, '[role="radio"][aria-label="#8E3B6E"]'));
  await clickButton(page, 'Next');
  await waitForPath(page, '/setup/3');
  await skipStep(page, 3, '/setup/4');
  await skipStep(page, 4, '/setup/5');
  await skipStep(page, 5, '/setup/6');
  await skipStep(page, 6, '/setup/done');
  await clickButton(page, 'Go to Home');
  await waitForPath(page, '/home');

  await page.goto(`${APP_URL}/settings/business`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Business details');
  await waitForText(page, 'Karnataka');
  console.log('OK — reopening Business profile shows the saved pincode/state/city.');

  // "Not found" falls back to manual entry, typed into that same now-saved pincode field.
  await typeInto(page, 'Pincode', '999999');
  await waitForText(page, "We couldn't find that pincode.");
  await clickButton(page, 'Enter city yourself');
  await waitForText(page, 'Choose a state');
  await page.screenshot({ path: `${STEP21B_SCREEN_DIR}/pincode-not-found-manual-390.png` });
  console.log('OK — an unknown pincode shows "not found" and offers manual entry.');

  await logoutFromAnywhere(page);
}

// Step 21d: onboard as restaurant_cafe, tick a starter stock item, go back to the sector step, and
// switch to small_manufacturing — the ChangeBusinessTypeSheet's "Remove them and start fresh"
// clears the restaurant item and lands straight on /setup/3 showing the manufacturing starter list.
// Also captures the 390px screenshots Light checks asks for, one per radio option.
async function checkSectorChangeFlow(page) {
  await mkdir(STEP21D_SCREEN_DIR, { recursive: true });
  const name = 'Sector Change Flow';
  const mobile = randomMobile();
  const password = `Flow${Math.floor(1000 + Math.random() * 9000)}!`;

  await signup(page, name, mobile, password, 'Spice Route Diner');
  await login(page, mobile, password);
  await waitForPath(page, '/setup/1');

  await fillStepOne(page, '411001', 'Restaurant or cafe');
  console.log('OK — onboarded as restaurant_cafe.');

  await clickAndSettle(await findVisible(page, '[role="radio"][aria-label="#8E3B6E"]'));
  await clickButton(page, 'Next');
  await waitForPath(page, '/setup/3');

  // Tick one starter stock item (Chicken, under "Meat & eggs" — restaurant_cafe's own catalogue)
  // and save it, so there's something for the sector-change sheet to ask about later.
  await waitForText(page, 'Pick from common items');
  await clickAndSettle(await findVisible(page, '[aria-label^="Meat & eggs ("]'));
  await clickAndSettle(await findVisible(page, '[aria-label="Chicken. kg"]'));
  await clickButton(page, '1 selected — Next');
  await waitForPath(page, '/setup/4');
  console.log('OK — ticked and saved one restaurant starter item (Chicken).');

  // Going back to the sector step via the wizard's own Back button (client-side navigation, not a
  // page reload — a reload would re-bootstrap auth and race setup/1's draft-from-`existing` state).
  await clickAndSettle(await findVisible(page, '[aria-label="Go back"]'));
  await waitForPath(page, '/setup/3');
  await clickAndSettle(await findVisible(page, '[aria-label="Go back"]'));
  await waitForPath(page, '/setup/2');
  await clickAndSettle(await findVisible(page, '[aria-label="Go back"]'));
  await waitForPath(page, '/setup/1');
  await waitForText(page, 'Your business');

  await clickAndSettle(await findVisibleByText(page, 'radio', 'Small manufacturing'));
  await clickButton(page, 'Next');
  await waitForText(page, "Changing to Small manufacturing. What should happen to them?");
  console.log('OK — switching the type with an item already added opens the decision sheet.');

  await page.screenshot({ path: `${STEP21D_SCREEN_DIR}/sheet-keep-390.png` });
  console.log('OK — "Keep my items" is preselected — 390px screenshot captured.');

  await clickAndSettle(await findVisible(page, '[aria-label="Remove them and start fresh"]'));
  await page.screenshot({ path: `${STEP21D_SCREEN_DIR}/sheet-remove-390.png` });
  console.log('OK — "Remove them and start fresh" selected — 390px screenshot captured.');

  await clickButton(page, 'Continue');
  await waitForPath(page, '/setup/3');
  await waitForText(page, 'Raw material');
  console.log('OK — "Remove and start fresh" lands straight on the manufacturing starter list.');

  // Filtered to elements with actual layout, same reasoning as findVisible() above — expo-router
  // keeps the previous /setup/3 screen's DOM mounted (hidden, zero-size) rather than unmounting it,
  // so an unfiltered textContent search would catch that stale copy of "Chicken" even once the
  // current screen has correctly dropped it.
  const stillHasChicken = await page.evaluate(() =>
    Array.from(document.querySelectorAll('*')).some((el) => {
      if (el.textContent?.trim() !== 'Chicken') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }),
  );
  if (stillHasChicken) {
    fail('sector change flow: Chicken (the removed restaurant item) is still showing on /setup/3');
  }
  console.log("OK — the removed restaurant item (Chicken) is gone from the new type's list.");

  await logoutFromAnywhere(page);
}

// Step C2a: the menu-scan flow — the onboarding "What you sell" choice screen, uploading a photo
// (AI_FAKE's canned menu: 3 dishes + 1 addon), the Analyzing screen, the Review screen (untick one,
// edit a price, add a dish by hand), saving, and the Done screen. restaurant_cafe has the choice
// enabled (menuScanEnabled); AI_FAKE's default canned menu needs no special marker file.
async function checkMenuScanFlow(page) {
  await mkdir(STEP25C2A_SCREEN_DIR, { recursive: true });
  const name = 'Menu Scan Flow';
  const mobile = randomMobile();
  const password = `Flow${Math.floor(1000 + Math.random() * 9000)}!`;

  await signup(page, name, mobile, password, 'Spice Route Diner');
  await login(page, mobile, password);
  await waitForPath(page, '/setup/1');

  await fillStepOne(page, '411001', 'Restaurant or cafe');
  await clickAndSettle(await findVisible(page, '[role="radio"][aria-label="#8E3B6E"]'));
  await clickButton(page, 'Next');
  await waitForPath(page, '/setup/3');
  await clickButton(page, 'Skip for now');
  await waitForPath(page, '/setup/4');
  console.log('OK — onboarded a restaurant_cafe business, reached step 4 with nothing added yet.');

  // === Choice screen: "Scan or upload your menu" is offered first, recommended ===
  await waitForText(page, 'Scan or upload your menu');
  await waitForText(page, 'Add one by one');
  await clickAndSettle(await findVisible(page, '[aria-label="Scan or upload your menu"]'));
  await waitForPath(page, '/menu-scan');
  console.log('OK — the choice screen opens, and "Scan or upload your menu" goes to the scan flow.');

  // === Source screen: choose a photo (a real file-chooser dialog, via Puppeteer's interception) ===
  await waitForText(page, 'Scan your menu');
  const [fileChooser] = await Promise.all([
    page.waitForFileChooser(),
    clickButton(page, 'Choose photos'),
  ]);
  await fileChooser.accept([STEP25C2A_FIXTURE_IMAGE]);
  await waitForText(page, 'Photos are used only to read your menu.');
  await retryUntil(async () => (await page.$$('img')).length > 0);
  // The thumbnail <img> exists as soon as the blob URL is set, but still needs a moment to decode.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.screenshot({ path: `${STEP25C2A_SCREEN_DIR}/source-390.png` });
  console.log('OK — a photo is picked, resized client-side, and shown as a thumbnail.');

  await clickButton(page, 'Read my menu');
  // AI_FAKE processes the scan inline during the create call itself, so by the time this polls,
  // "done" may already be true and the Analyzing screen already passed through — waits for either
  // path, and only screenshots Analyzing if it actually caught it.
  await retryUntil(async () => {
    const path = await page.evaluate(() => location.pathname);
    return path === '/menu-scan/analyzing' || path === '/menu-scan/review';
  });
  if ((await page.evaluate(() => location.pathname)) === '/menu-scan/analyzing') {
    await page.screenshot({ path: `${STEP25C2A_SCREEN_DIR}/analyzing-390.png` });
  }
  console.log('OK — submitting opens the Analyzing screen and polls the scan.');

  // === Review screen: untick one, edit a price, add a dish by hand ===
  // Dish names live inside editable TextField/Checkbox values, not plain text nodes, so they're
  // found via their aria-label (an input's value is invisible to document.body.innerText).
  await waitForPath(page, '/menu-scan/review');
  await findVisible(page, '[aria-label="Fake Dish 1"]');
  await findVisible(page, '[aria-label^="Fake Dish 3"]');
  await page.screenshot({ path: `${STEP25C2A_SCREEN_DIR}/review-390.png` });
  console.log('OK — the Review screen lists the scanned dishes, grouped by section.');

  await clickAndSettle(await findVisible(page, '[aria-label="Fake Dish 1"]'));
  console.log('OK — unticked one dish.');

  await typeInto(page, 'Selling price — Fake Dish 2', '150');
  console.log('OK — edited a price inline.');

  await clickButton(page, 'Add a dish');
  // Typing the name immediately relabels the price field too (both carry the dish's current name
  // for a11y) — so the price field is found by its post-rename label, not "Untitled item".
  await typeInto(page, 'Name — Untitled item', 'Mango Kulfi');
  await typeInto(page, 'Selling price — Mango Kulfi', '60');
  console.log('OK — added a dish by hand, filled in from the review list itself.');

  await clickButton(page, 'Add 3 dishes');
  await waitForPath(page, '/menu-scan/done');
  console.log('OK — saving the ticked dishes goes through sell-items/bulk/ and lands on Done.');

  // === Done screen ===
  await waitForText(page, '3 dishes added.');
  await page.screenshot({ path: `${STEP25C2A_SCREEN_DIR}/done-390.png` });
  console.log(`OK — saved Step C2a screenshots at 390px to ${STEP25C2A_SCREEN_DIR}/.`);

  await clickButton(page, 'Continue');
  await waitForPath(page, '/setup/5');
  console.log('OK — Continue resumes the onboarding wizard at step 5.');

  // === Step C2c: a scan that never finishes shows the "taking longer than usual" escape hatch ===
  // (started from the same business via the Settings entry point). The web dev server can be
  // started with EXPO_PUBLIC_MENU_SCAN_STUCK_AFTER_MS set small to make this fast; against the real
  // 3-minute default (analyzing.tsx's STUCK_AFTER_MS) this just waits it out instead.
  await page.goto(`${APP_URL}/menu-scan?returnTo=settings`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Scan your menu');
  const [stuckFileChooser] = await Promise.all([
    page.waitForFileChooser(),
    clickButton(page, 'Choose a PDF'),
  ]);
  await stuckFileChooser.accept([STEP25C2C_STUCK_FIXTURE_PDF]);
  await waitForText(page, 'menu_scan_force_never_finish.pdf');
  await clickButton(page, 'Read my menu');
  await waitForPath(page, '/menu-scan/analyzing');
  await retryUntil(
    async () => (await page.evaluate(() => document.body.innerText)).includes('This is taking longer than usual.'),
    STEP25C2C_STUCK_WAIT_MS,
  );
  await waitForText(page, 'Try again');
  await waitForText(page, 'Add one by one');
  await page.screenshot({ path: `${STEP25C2A_SCREEN_DIR}/analyzing-stuck-390.png` });
  console.log('OK — Step C2c: a scan stuck past the timeout shows Try again / Add one by one.');

  await clickButton(page, 'Add one by one');
  await waitForPath(page, '/settings/sell');
  console.log('OK — "Add one by one" from the stuck screen returns to Settings.');

  await logoutFromAnywhere(page);
}

// ---------- scenario tiering (--only <name>, --list) ----------

/** Every scenario in the order main() runs them. "chain" scenarios share one Owner business/
 * session built up step by step (signup, wizard, team, purchase, counts, ...) — picking one with
 * `--only` runs every earlier chain scenario first, in order, to rebuild the state it needs, then
 * stops right after it (skipping every later chain scenario and every "solo" one). A "solo"
 * scenario signs up its own fresh business and never touches the shared chain state, so `--only`
 * on one of those runs nothing else at all. */
const FLOW_SCENARIOS = [
  { name: 'landing', kind: 'solo' },
  { name: 'wizard', kind: 'chain' },
  { name: 'purchase', kind: 'chain' },
  { name: 'opening-count', kind: 'chain' },
  { name: 'resume-wizard', kind: 'solo' },
  { name: 'skip-wizard', kind: 'solo' },
  { name: 'helper-today', kind: 'chain' },
  { name: 'headchef-today', kind: 'chain' },
  { name: 'manager-home', kind: 'chain' },
  { name: 'count-review', kind: 'chain' },
  { name: 'settings', kind: 'chain' },
  { name: 'sales', kind: 'chain' },
  { name: 'alerts-profile', kind: 'chain' },
  { name: 'team-management', kind: 'chain' },
  { name: 'reports', kind: 'chain' },
  { name: 'reports-empty', kind: 'solo' },
  { name: 'pincode', kind: 'solo' },
  { name: 'sector-change', kind: 'solo' },
  { name: 'step10-screens', kind: 'solo' },
  { name: 'step12-screens', kind: 'chain' },
  { name: 'step13-screens', kind: 'chain' },
  { name: 'menu-scan', kind: 'solo' },
];

function parseFlowArgs() {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf('--only');
  return {
    only: onlyIdx !== -1 ? args[onlyIdx + 1] : null,
    list: args.includes('--list'),
  };
}

function listFlowScenarios() {
  console.log('Flow scenarios (npm run flow -- --only <name>):\n');
  for (const s of FLOW_SCENARIOS) console.log(`  ${s.name.padEnd(18)} (${s.kind})`);
  console.log(
    '\nA "chain" scenario shares one Owner business/session with every chain scenario before it ' +
      'in\nthis list — picking one runs those first, in order, then stops right after it. A ' +
      '"solo"\nscenario builds its own business and runs completely on its own.',
  );
}

/** True if `name`'s scenario must run on the way to `only` (or always, when `only` is unset). */
function shouldRunFlowScenario(name, only) {
  if (!only) return true;
  const self = FLOW_SCENARIOS.find((s) => s.name === name);
  if (self.kind === 'solo') return name === only;
  const target = FLOW_SCENARIOS.find((s) => s.name === only);
  if (!target || target.kind === 'solo') return false;
  const chainOrder = FLOW_SCENARIOS.filter((s) => s.kind === 'chain').map((s) => s.name);
  return chainOrder.indexOf(name) <= chainOrder.indexOf(only);
}

const flowTimings = [];

/** Times one scenario's body and records it for the end-of-run "slowest scenarios" summary —
 * wraps the body, nothing inside it changes. */
async function timed(name, fn) {
  const t0 = Date.now();
  await fn();
  flowTimings.push([name, (Date.now() - t0) / 1000]);
}

async function main() {
  const { only, list } = parseFlowArgs();
  if (list) {
    listFlowScenarios();
    return;
  }
  if (only && !FLOW_SCENARIOS.some((s) => s.name === only)) {
    fail(`unknown flow scenario "${only}" — run with --list to see valid names.`);
  }
  const shouldRun = (name) => shouldRunFlowScenario(name, only);

  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  await mkdir(SCREEN_DIR, { recursive: true });
  // Reuses an already-running landing server (e.g. `npm run dev`) if one answers at that port;
  // otherwise starts a throwaway one for the duration of this run — "/" won't have anywhere real to
  // land without it.
  const landingServer = await ensureLandingServer(8082);

  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => fail(`a JS error occurred in the page: ${err}`));

    // Tall enough that every field on every wizard screen fits without scrolling — sidesteps both
    // react-native-web's internally-scrolling ScrollView (native scrollIntoView is a no-op for it)
    // and the sticky BottomActionBar occluding whatever sits directly above it. Set unconditionally
    // (not just for the "landing" scenario right below) — every later scenario assumes it too.
    await page.setViewport({ width: 390, height: 3000 });

    if (shouldRun('landing')) {
      await timed('landing', async () => {
        await captureStep8cScreens(page);
        await checkRootSignedOutToLanding(page);
      });
    }

    let name, mobile, password;
    let helperMobile, helperPin, headChefMobile, headChefPin, managerMobile, managerPassword;

    if (shouldRun('wizard'))
      await timed('wizard', async () => {
    // === User 1: full flow through all six wizard steps ===
    name = 'Flow Test';
    mobile = randomMobile();
    password = `Flow${Math.floor(1000 + Math.random() * 9000)}!`;

    await signup(page, name, mobile, password, "Anita's Kitchen");
    await waitForText(page, 'Account created. Log in to set up your business.');
    console.log('OK — signup submitted, redirected to /login with the success banner.');

    const mobileValue = await readValue(page, 'Mobile number');
    if (mobileValue !== mobile) {
      fail(`login's mobile field is not pre-filled: expected ${mobile}, got ${mobileValue}`);
    }
    console.log('OK — mobile number pre-filled on /login.');

    await login(page, mobile, password);
    await waitForPath(page, '/setup/1');
    console.log('OK — logged in with the business signup already created, landed on /setup/1.');

    // Step F2: the name is shown as a line (not an input) with a Change link — never re-asked.
    await waitForText(page, "Anita's Kitchen");
    await waitForText(page, 'Change');
    console.log('OK — step 1 shows the signup business name, not an input asking for it again.');

    await fillStepOne(page, '411001', 'Cloud kitchen');
    console.log('OK — step 1 saved, moved to /setup/2.');

    await clickAndSettle(await findVisible(page, '[role="radio"][aria-label="#8E3B6E"]'));
    await waitForPreviewColour(page, "Anita's Kitchen", '#8E3B6E');
    console.log('OK — picking a colour updates the live preview.');

    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/3');
    console.log('OK — step 2 saved, moved to /setup/3.');

    // Step 20: the starter-pack picker — grouped, collapsed by default (cloud kitchen has 9
    // groups), with a search box and a "Can't find it? Add your own" quick add. Nothing here saves
    // until this step's own Next.
    await mkdir(STEP20_SCREEN_DIR, { recursive: true });
    await waitForText(page, 'Pick from common items');
    await page.screenshot({ path: `${STEP20_SCREEN_DIR}/picker-collapsed-390.png` });
    console.log('OK — Step 20: the starter picker opens with its groups collapsed.');

    // Expand two different groups and tick one item from each — Rice (Groceries & dry goods) and
    // Cooking oil (Oils & sauces) — proving a selection spans groups, not just one.
    await clickAndSettle(await findVisible(page, '[aria-label^="Groceries & dry goods ("]'));
    await page.screenshot({ path: `${STEP20_SCREEN_DIR}/picker-expanded-390.png` });
    await clickAndSettle(await findVisible(page, '[aria-label="Rice. kg"]'));
    await clickAndSettle(await findVisible(page, '[aria-label^="Oils & sauces ("]'));
    await clickAndSettle(await findVisible(page, '[aria-label="Cooking oil. L"]'));
    console.log('OK — ticked two starter stock items across two different groups.');

    await typeInto(page, 'Search', 'egg');
    await waitForText(page, 'Eggs');
    await page.screenshot({ path: `${STEP20_SCREEN_DIR}/picker-search-390.png` });
    console.log('OK — Step 20: the search box filters the picker across every group.');

    // "Can't find it? Add your own" — name/unit/group only, added to the local selection, not
    // saved until this step's own Next (unlike Step 19's old always-inline-save add form).
    await typeInto(page, 'Name', 'Fresh Paneer');
    await clickAndSettle(await findVisibleByText(page, 'radio', 'kg'));
    await typeInto(page, 'Group (optional)', 'Dairy');
    await clickButton(page, 'Add to list');
    await waitForText(page, 'Added by you');
    await waitForText(page, 'Fresh Paneer');
    console.log('OK — added one own stock item (name/unit/group only) to the selection.');

    // The sticky bar's label now carries the selection count — 2 ticked + 1 added by hand.
    await clickButton(page, '3 selected — Next');
    await waitForPath(page, '/setup/4');
    console.log('OK — step 3 saved: ticked items + the custom one, all in one bulk request.');

    // Confirm the bulk save actually landed and groups the items for real, the same list screen
    // Step 19 proved this on — going back from /setup/4 shows them as "Added items" now, grouped
    // under real headings including "Dairy" for Fresh Paneer.
    await page.goto(`${APP_URL}/setup/3`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await waitForText(page, 'Added items');
    await waitForText(page, 'Dairy (1)');
    console.log('OK — Step 20: the saved items come back grouped under real headings, including "Dairy".');
    await page.goto(`${APP_URL}/setup/4`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await waitForPath(page, '/setup/4');

    // Step C2a: cloud_kitchen has the menu-scan choice enabled and nothing's been added yet, so
    // step 4 opens on the scan/manual choice card instead of the form directly — "Add one by one"
    // is this scenario's unchanged, pre-C2a path.
    await waitForText(page, 'Add one by one');
    await clickAndSettle(await findVisible(page, '[aria-label="Add one by one"]'));
    console.log('OK — Step C2a: "Add one by one" on the choice screen opens the manual form.');

    // Step 22a2: the wizard's "Add your own" dish form now opens the same DishRecipeForm sheet as
    // Settings' "What you sell" — a dish can't be saved here without at least one real ingredient
    // either. The starter-pack tick below (Veg biryani) is still the no-ingredients path, reused by
    // checkSettingsFlow to prove the dish list's "Needs ingredients" badge.
    await mkdir(STEP19_SCREEN_DIR, { recursive: true });
    await waitForText(page, 'Add your own');
    await page.screenshot({ path: `${STEP19_SCREEN_DIR}/add-your-own-dish-390.png` });
    console.log('OK — Step 22a2: the wizard step still has its "Add your own" section.');

    await clickAndSettle(await findVisible(page, '[aria-label="Veg biryani"]'));
    // Step 22a2: the "Add your own" section no longer has an always-mounted Selling price field of
    // its own (it's just a button that opens the dish sheet now) — the starter item's inline price
    // box is the only "Selling price" field on the page at this point.
    await typeInto(page, 'Selling price', '120');
    console.log('OK — ticked one starter sell item and set a price.');

    // === Step 22a2: "Add menu item" opens the full dish form (portion + ingredients), same as
    // Settings — pick 3 ingredients already on hand from Step 3 (Fresh Paneer, Rice, Cooking oil) ===
    await mkdir(STEP22A2_SCREEN_DIR, { recursive: true });
    await clickButton(page, 'Add menu item');
    await waitForText(page, 'Add a dish');
    await waitForText(page, '+ Add ingredient');
    // The sheet animates in — a short settle avoids catching it mid-fade, same as other sheet shots.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.screenshot({ path: `${STEP22A2_SCREEN_DIR}/onboarding-dish-form-390.png` });
    console.log('OK — Step 22a2: "Add menu item" on the onboarding screen opens the dish form.');

    await typeInto(page, 'Name', 'Mango Lassi', { last: true });
    await typeInto(page, 'Selling price', '30', { last: true });
    await typeInto(page, 'Portion (optional)', '1 glass', { last: true });

    await clickButton(page, '+ Add ingredient');
    await waitForText(page, 'Choose an item');
    await clickButton(page, 'Fresh Paneer');
    await typeInto(page, 'Amount', '0.050');
    console.log('OK — picked Fresh Paneer as the first ingredient.');

    await clickButton(page, '+ Add ingredient');
    await waitForText(page, 'Choose an item');
    await clickButton(page, 'Rice');
    await typeInto(page, 'Amount', '0.100', { last: true, minCount: 2 });
    console.log('OK — picked Rice as a second ingredient.');

    await clickButton(page, '+ Add ingredient');
    await waitForText(page, 'Choose an item');
    await clickButton(page, 'Cooking oil');
    await typeInto(page, 'Amount', '0.010', { last: true, minCount: 3 });
    console.log('OK — picked Cooking oil as a third ingredient.');

    await clickButton(page, 'Save dish');
    await waitForText(page, 'Dish added');
    await waitForText(page, 'Mango Lassi');
    console.log('OK — added a dish with 3 ingredients from the onboarding screen.');

    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/5');
    console.log('OK — step 4 saved, moved to /setup/5.');

    const helperMobile = randomMobile();
    const helperPin = '7392';
    await typeInto(page, 'Name', 'Helper One');
    await typeInto(page, 'Mobile number', helperMobile);
    await clickAndSettle(await findVisibleByText(page, 'radio', 'Helper'));
    await typeInto(page, 'PIN', helperPin);
    await clickButton(page, 'Add person');
    await waitForText(page, 'Helper One');
    console.log('OK — added a Helper with a PIN.');

    // Step 10: also add a Head chef, for the counts.status Today-screen scenario below.
    const headChefMobile = randomMobile();
    const headChefPin = '8417';
    await typeInto(page, 'Name', 'Chef Rahul', { last: true });
    await typeInto(page, 'Mobile number', headChefMobile, { last: true });
    // This business is "Cloud kitchen" — sectorCopy.json's roleLabels shows the Head chef role as
    // "Head cook" there, not the literal role name (see mobile/src/labels.ts's roleLabel()).
    await clickAndSettle(await findVisibleByText(page, 'radio', 'Head cook'));
    await typeInto(page, 'PIN', headChefPin, { last: true });
    await clickButton(page, 'Add person');
    await waitForText(page, 'Chef Rahul');
    console.log('OK — added a Head chef with a PIN.');

    // Step 11: a Manager too, for the "no Start stock count button" scenario below.
    const managerMobile = randomMobile();
    const managerPassword = 'Manager1234!';
    await typeInto(page, 'Name', 'Manoj Manager', { last: true });
    await typeInto(page, 'Mobile number', managerMobile, { last: true });
    await clickAndSettle(await findVisibleByText(page, 'radio', 'Manager'));
    await typeInto(page, 'Temporary password', managerPassword);
    await clickButton(page, 'Add person');
    await waitForText(page, 'Manoj Manager');
    console.log('OK — added a Manager with a temporary password.');

    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/6');
    console.log('OK — step 5 saved, moved to /setup/6.');

    await clickButton(page, 'Use recommended settings');
    await waitForPath(page, '/setup/done');
    console.log('OK — used recommended settings, step 6 saved, moved to /setup/done.');

    await waitForText(page, "You're all set");
    const doneBodyText = await page.evaluate(() => document.body.innerText);
    if (doneBodyText.includes('Still to do')) {
      fail('a fully-completed wizard should not list anything as "Still to do"');
    }
    console.log('OK — /setup/done shows the summary with nothing "Still to do".');

    await clickButton(page, 'Go to Home');
    await waitForPath(page, '/home');
    const homeBodyText = await page.evaluate(() => document.body.innerText);
    if (homeBodyText.includes('Finish setting up')) {
      fail('a fully-completed Owner should not see the "Finish setting up" card');
    }
    console.log('OK — /home shows no "Finish setting up" card once nothing is left.');

    await clickAndSettle(await findVisible(page, '[aria-label="Open profile menu"]'));
    await waitForText(page, 'Profile');
    await clickButton(page, 'Log out');
    await waitForPath(page, '/login');
    console.log('OK — the avatar opens the profile sheet, and Log out from there lands on /login.');
    await login(page, mobile, password);
    await waitForPath(page, '/home');
    console.log('OK — after finishing all six steps, logging back in lands on /home.');

    await page.goto(`${APP_URL}/`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await waitForPath(page, '/home');
    console.log('OK — opening "/" again while signed in and onboarded lands on /home.');
      });

    if (shouldRun('purchase'))
      await timed('purchase', async () => {
    // === Step 9: Owner records, views, and deletes a purchase; Stock reflects the new price ===
    await checkPurchaseFlow(page);
      });

    if (shouldRun('opening-count'))
      await timed('opening-count', async () => {
    // === Step 10: Owner submits the opening stock count (baseline for the Helper's closing count
    // further down, once the wizard-created Helper/Head chef accounts below exist) ===
    await checkOwnerOpeningCount(page);

    await logoutFromAnywhere(page);
    console.log('OK — logging out lands on /login.');
      });

    if (shouldRun('resume-wizard'))
      await timed('resume-wizard', async () => {
    // === User 2: stop after step 1, confirm resume at /setup/2 ===
    const name2 = 'Resume Test';
    const mobile2 = randomMobile();
    const password2 = `Flow${Math.floor(1000 + Math.random() * 9000)}!`;

    await signup(page, name2, mobile2, password2, "Resume Test's Bakery");
    await login(page, mobile2, password2);
    await waitForPath(page, '/setup/1');
    await fillStepOne(page, '400001', 'Bakery or sweets');

    // /setup/2 itself has no logout button (only the wizard controls) — go to /home, which does,
    // to log out. Resuming depends only on the business's saved onboarding_step, not on which
    // screen happened to be open, so this is still a faithful "left mid-wizard" scenario.
    await logoutFromAnywhere(page);
    await login(page, mobile2, password2);
    await waitForPath(page, '/setup/2');
    console.log('OK — leaving mid-wizard after step 1 and logging back in resumes at /setup/2.');

    await logoutFromAnywhere(page);
      });

    if (shouldRun('skip-wizard'))
      await timed('skip-wizard', async () => {
    // === User 3: fill steps 1-2, skip 3, 4, 5 and 6, confirm the "Still to do" / checklist / resume ===
    const name3 = 'Skip Test';
    const mobile3 = randomMobile();
    const password3 = `Flow${Math.floor(1000 + Math.random() * 9000)}!`;

    await signup(page, name3, mobile3, password3, "Skip Test's Shop");
    await login(page, mobile3, password3);
    await waitForPath(page, '/setup/1');
    await fillStepOne(page, '600001', 'Other');
    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/3');

    await skipStep(page, 3, '/setup/4');
    await skipStep(page, 4, '/setup/5');
    await skipStep(page, 5, '/setup/6');
    await skipStep(page, 6, '/setup/done');

    await waitForText(page, "You're all set");
    await waitForText(page, 'Still to do');
    for (const title of ['What you buy', 'What you sell', 'Your team', 'Alerts and rules']) {
      await waitForText(page, title);
    }
    console.log('OK — /setup/done lists all four skipped steps as "Still to do".');

    await clickButton(page, 'Go to Home');
    await waitForPath(page, '/home');
    await waitForText(page, 'Finish setting up');
    for (const title of ['What you buy', 'What you sell', 'Your team', 'Alerts and rules']) {
      await waitForText(page, title);
    }
    console.log('OK — /home\'s "Finish setting up" card lists all four skipped steps.');

    // Four "Continue" links exist (one per skipped step); the backend lists them step-ascending and
    // the card renders in that order, so the first visible one is "What you buy" (step 3).
    const continueLink = await findVisibleByText(page, 'button', 'Continue');
    await continueLink.click();
    await waitForPath(page, '/setup/3');
    console.log('OK — clicking Continue on "What you buy" resumes at /setup/3.');

    await logoutFromAnywhere(page);
      });

    // === Step 10: the Helper (from User 1) counts stock, confirms an unusual value, and records
    // wastage; the Head chef (also from User 1) sees the team Today screen; the Owner reviews both
    // counts and the Helper's wastage entry, then deletes it ===
    if (shouldRun('helper-today'))
      await timed('helper-today', async () => {
    await checkHelperTodayFlow(page, helperMobile, helperPin);
    await logoutFromAnywhere(page);
      });
    if (shouldRun('headchef-today'))
      await timed('headchef-today', async () => {
    await checkHeadChefTodayFlow(page, headChefMobile, headChefPin);
    await logoutFromAnywhere(page);
      });
    if (shouldRun('manager-home'))
      await timed('manager-home', async () => {
    await checkManagerHomeFlow(page, managerMobile, managerPassword);
    await logoutFromAnywhere(page);
      });
    if (shouldRun('count-review'))
      await timed('count-review', async () => {
    await checkCountReviewAndWastageFlow(page, mobile, password);
      });
    if (shouldRun('settings'))
      await timed('settings', async () => {
    await checkSettingsFlow(page);
      });
    if (shouldRun('sales'))
      await timed('sales', async () => {
    await checkSalesFlow(page);
      });
    if (shouldRun('alerts-profile'))
      await timed('alerts-profile', async () => {
    await checkAlertsAndProfileFlow(page, name);
      });
    if (shouldRun('team-management'))
      await timed('team-management', async () => {
    // checkAlertsAndProfileFlow ends by logging out via the profile sheet — back in as Owner for
    // the team management scenario below.
    await login(page, mobile, password);
    await waitForPath(page, '/home');
    await checkTeamManagementFlow(page, 'Helper One');
    await logoutFromAnywhere(page);
      });

    if (shouldRun('reports'))
      await timed('reports', async () => {
    await login(page, mobile, password);
    await waitForPath(page, '/home');
    await checkReportsFlow(page);
    await captureStep16Screens(page);
    await logoutFromAnywhere(page);
      });
    if (shouldRun('reports-empty'))
      await timed('reports-empty', async () => {
    await checkReportsEmptyStateFlow(page);
      });
    if (shouldRun('pincode'))
      await timed('pincode', async () => {
    await checkPincodeLocationFlow(page);
      });
    if (shouldRun('sector-change'))
      await timed('sector-change', async () => {
    await checkSectorChangeFlow(page);
      });

    if (shouldRun('step10-screens'))
      await timed('step10-screens', async () => {
    await captureStep10Screens(page);
      });
    if (shouldRun('step12-screens'))
      await timed('step12-screens', async () => {
    await captureStep12Screens(page, mobile, password);
      });
    if (shouldRun('step13-screens'))
      await timed('step13-screens', async () => {
    await captureStep13Screens(page, mobile, password, 'Chef Rahul');
      });
    if (shouldRun('menu-scan'))
      await timed('menu-scan', async () => {
    await checkMenuScanFlow(page);
      });

    console.log(only ? `\nOK — scenario "${only}" passed.` : '\nAll flow checks passed.');
    if (flowTimings.length > 1) {
      console.log('\nSlowest scenarios:');
      for (const [n, s] of [...flowTimings].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
        console.log(`  ${s.toFixed(1)}s  ${n}`);
      }
    }
  } catch (err) {
    const page = (await browser.pages()).at(-1);
    if (page) {
      await page.screenshot({ path: `${SCREEN_DIR}/_flow_failure.png` }).catch(() => {});
      console.error('URL at failure:', page.url());
    }
    throw err;
  } finally {
    await browser.close();
    if (landingServer) landingServer.close();
  }
}

main().catch((err) => fail(err.stack ?? String(err)));
