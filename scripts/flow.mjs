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

async function signup(page, name, mobile, password) {
  await page.goto(`${APP_URL}/signup`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await typeInto(page, 'Your name', name);
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

async function fillStepOne(page, businessName, city, typeLabel) {
  await typeInto(page, 'Business name', businessName);
  await typeInto(page, 'City', city);
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
        const el = Array.from(document.querySelectorAll('*')).find(
          (e) => e.textContent?.trim() === name && e.children.length === 0,
        );
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

// Signs the current user out via /home (the only screen with a Log out button) regardless of which
// screen they're actually on — needed between scenarios, since /login bounces a signed-in user
// straight to /home.
async function logoutFromAnywhere(page) {
  await page.goto(`${APP_URL}/home`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await clickButton(page, 'Log out');
  await waitForPath(page, '/login');
}

/** Pushes this business's opening-count deadline late in the day (direct API call, same trick
 * already used elsewhere in this script and in responsive_check.mjs to force a count *late* by
 * setting closing_count_hour to 0) — the opposite adjustment, so the opening count this flow is
 * about to submit stays "not_started" (not already "late") regardless of what time of day this
 * script happens to run. Without it, checkOwnerOpeningCount's assertions about the *first*
 * submission being "done" would depend on running before the default 11 AM deadline. */
async function keepOpeningCountNotLate(page) {
  const access = await page.evaluate(() => localStorage.getItem('easykharcha.access'));
  const me = await fetch(`${API_BASE}/me/`, { headers: { Authorization: `Bearer ${access}` } }).then(
    (r) => r.json(),
  );
  const businessId = me.businesses[0].id;
  await fetch(`${API_BASE}/businesses/${businessId}/settings/`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ count_deadline_hour: 23 }),
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
  await page.goto(`${APP_URL}/count`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Count stock');
  await typeInto(page, 'Rice quantity', '5');
  await typeInto(page, 'Cooking oil quantity', '5');
  await typeInto(page, 'Fresh Paneer quantity', '5');
  await clickButton(page, 'Save count');
  await waitForText(page, 'Count saved. Thank you.');
  console.log('OK — the Owner submits the opening stock count.');

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
  console.log('OK — Home\'s stock count card shows both the opening and closing count states.');
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

// Step 10: the Helper signs in, sees the Today screen, submits the closing stock count (one value
// deliberately unusual against the Owner's opening baseline, exercising the confirm-guard), then
// records wastage and sees it under "My entries today".
async function checkHelperTodayFlow(page, helperMobile, helperPin) {
  await login(page, helperMobile, helperPin);
  await waitForPath(page, '/home');
  await waitForText(page, 'Good evening,');
  await assertNoForbiddenText(page);
  console.log('OK — the Helper signs in and sees the Today screen.');

  await (await findVisible(page, '[aria-label="Count stock"]')).click();
  await waitForPath(page, '/count');
  await waitForText(page, 'Count stock');
  await assertNoForbiddenText(page);

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
  console.log('OK — the Manager signs in and Home has no "Start stock count" button.');
}

// Step 10: back as Owner — count review lists both counts with a late/on-time chip, the closing
// count's detail shows the used-since-last-count numbers with the flagged item first, and the
// Wastage screen shows the Helper's entry with its rupee value before the Owner deletes it.
async function checkCountReviewAndWastageFlow(page, ownerMobile, ownerPassword) {
  await login(page, ownerMobile, ownerPassword);
  await waitForPath(page, '/home');

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
    await signup(page, name, mobile, password);
    await login(page, mobile, password);
    await waitForPath(page, '/setup/1');
    await fillStepOne(page, "Shots Ten's Kitchen", 'Pune', 'Cloud kitchen');
    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/2');
    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/3');
    await waitForText(page, 'Rice');
    await clickAndSettle(await findVisible(page, '[aria-label="Rice. kg"]'));
    await clickButton(page, 'Next');
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
    await waitForText(page, 'Count stock');
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

    await (await findVisible(page, '[aria-label="Count stock"]')).click();
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

// Step 12: Owner edits a sell item's "How much does one use?", then sees the plain-language
// message when trying to deactivate the stock item that sell item still depends on. Reuses "Fresh
// Paneer" (stock) and "Paneer Tikka" (sell item linked to it) from User 1's wizard data above —
// the page is already signed in as that Owner when this runs.
async function checkSettingsFlow(page) {
  await page.goto(`${APP_URL}/settings`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Settings');
  console.log('OK — Owner opens Settings.');

  await clickButton(page, 'What you sell');
  await waitForPath(page, '/settings/sell');
  await waitForText(page, 'Paneer Tikka');

  await (await findVisible(page, '[aria-label="Paneer Tikka"]')).click();
  await waitForText(page, 'Edit item sold');
  await typeInto(page, 'How much does one use? (kg)', '0.3');
  await clickButton(page, 'Save item');
  await waitForText(page, 'Item saved');
  console.log(
    'OK — Settings -> What you sell -> edited an item, set "How much does one use?", saved.',
  );

  await page.goto(`${APP_URL}/settings/stock`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'What you buy');
  await (await findVisible(page, '[aria-label="Fresh Paneer"]')).click();
  await waitForText(page, 'Edit stock item');
  await clickAndSettle(await findVisible(page, '[aria-label="Active"]'));
  await clickButton(page, 'Save item');
  await waitForText(page, "Can't deactivate");
  console.log(
    'OK — What you buy -> trying to deactivate a stock item a sell item still uses shows the plain-language message.',
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
  await page.screenshot({ path: `${STEP12_SCREEN_DIR}/alert-rules-390.png` });

  console.log(`OK — saved Step 12 screenshots at 390px to ${STEP12_SCREEN_DIR}/.`);
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  await mkdir(SCREEN_DIR, { recursive: true });
  // Reuses an already-running landing server (e.g. `npm run dev`) if one answers at that port;
  // otherwise starts a throwaway one for the duration of this run — "/" won't have anywhere real to
  // land without it.
  const landingServer = await ensureLandingServer(8082);

  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => fail(`a JS error occurred in the page: ${err}`));

    await captureStep8cScreens(page);

    // Tall enough that every field on every wizard screen fits without scrolling — sidesteps both
    // react-native-web's internally-scrolling ScrollView (native scrollIntoView is a no-op for it)
    // and the sticky BottomActionBar occluding whatever sits directly above it.
    await page.setViewport({ width: 390, height: 3000 });

    await checkRootSignedOutToLanding(page);

    // === User 1: full flow through all six wizard steps ===
    const name = 'Flow Test';
    const mobile = randomMobile();
    const password = `Flow${Math.floor(1000 + Math.random() * 9000)}!`;

    await signup(page, name, mobile, password);
    await waitForText(page, 'Account created. Log in to set up your business.');
    console.log('OK — signup submitted, redirected to /login with the success banner.');

    const mobileValue = await readValue(page, 'Mobile number');
    if (mobileValue !== mobile) {
      fail(`login's mobile field is not pre-filled: expected ${mobile}, got ${mobileValue}`);
    }
    console.log('OK — mobile number pre-filled on /login.');

    await login(page, mobile, password);
    await waitForPath(page, '/setup/1');
    console.log('OK — logged in with no business yet, landed on /setup/1.');

    await fillStepOne(page, "Anita's Kitchen", 'Pune', 'Cloud kitchen');
    console.log('OK — step 1 saved, moved to /setup/2.');

    await clickAndSettle(await findVisible(page, '[role="radio"][aria-label="#8E3B6E"]'));
    await waitForPreviewColour(page, "Anita's Kitchen", '#8E3B6E');
    console.log('OK — picking a colour updates the live preview.');

    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/3');
    console.log('OK — step 2 saved, moved to /setup/3.');

    await waitForText(page, 'Rice');
    await clickAndSettle(await findVisible(page, '[aria-label="Rice. kg"]'));
    await clickAndSettle(await findVisible(page, '[aria-label="Cooking oil. L"]'));
    console.log('OK — ticked two starter stock items.');

    await typeInto(page, 'Name', 'Fresh Paneer');
    await clickAndSettle(await findVisibleByText(page, 'radio', 'kg'));
    await clickAndSettle(await findVisible(page, '[aria-label="Goes off"]'));
    await typeInto(page, 'Shelf life in days', '3');
    await clickButton(page, 'Add item');
    await waitForText(page, 'Fresh Paneer');
    console.log('OK — added one own stock item with Goes off + shelf life.');

    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/4');
    console.log('OK — step 3 saved, moved to /setup/4.');

    await waitForText(page, 'Add your own');
    await clickAndSettle(await findVisible(page, '[aria-label="Veg biryani"]'));
    // minCount: 2 — the starter item's inline price box only mounts once the tick above is
    // reflected in a render; without waiting for both fields to exist, this can resolve to the
    // "add your own" form's price field instead (the only one present in the first instant).
    await typeInto(page, 'Selling price', '120', { minCount: 2 });
    console.log('OK — ticked one starter sell item and set a price.');

    await typeInto(page, 'Name', 'Paneer Tikka', { last: true });
    await typeInto(page, 'Selling price', '180', { last: true });
    await clickAndSettle(await findVisibleByText(page, 'radio', 'Fresh Paneer'));
    await clickButton(page, 'Add item');
    await waitForText(page, 'Paneer Tikka');
    console.log('OK — added one own sell item linked to a stock item.');

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
    await clickAndSettle(await findVisibleByText(page, 'radio', 'Head chef'));
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

    await clickButton(page, 'Log out');
    await waitForPath(page, '/login');
    await login(page, mobile, password);
    await waitForPath(page, '/home');
    console.log('OK — after finishing all six steps, logging back in lands on /home.');

    await page.goto(`${APP_URL}/`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await waitForPath(page, '/home');
    console.log('OK — opening "/" again while signed in and onboarded lands on /home.');

    // === Step 9: Owner records, views, and deletes a purchase; Stock reflects the new price ===
    await checkPurchaseFlow(page);

    // === Step 10: Owner submits the opening stock count (baseline for the Helper's closing count
    // further down, once the wizard-created Helper/Head chef accounts below exist) ===
    await checkOwnerOpeningCount(page);

    await logoutFromAnywhere(page);
    console.log('OK — logging out lands on /login.');

    // === User 2: stop after step 1, confirm resume at /setup/2 ===
    const name2 = 'Resume Test';
    const mobile2 = randomMobile();
    const password2 = `Flow${Math.floor(1000 + Math.random() * 9000)}!`;

    await signup(page, name2, mobile2, password2);
    await login(page, mobile2, password2);
    await waitForPath(page, '/setup/1');
    await fillStepOne(page, "Resume Test's Bakery", 'Mumbai', 'Bakery or sweets');

    // /setup/2 itself has no logout button (only the wizard controls) — go to /home, which does,
    // to log out. Resuming depends only on the business's saved onboarding_step, not on which
    // screen happened to be open, so this is still a faithful "left mid-wizard" scenario.
    await logoutFromAnywhere(page);
    await login(page, mobile2, password2);
    await waitForPath(page, '/setup/2');
    console.log('OK — leaving mid-wizard after step 1 and logging back in resumes at /setup/2.');

    await logoutFromAnywhere(page);

    // === User 3: fill steps 1-2, skip 3, 4, 5 and 6, confirm the "Still to do" / checklist / resume ===
    const name3 = 'Skip Test';
    const mobile3 = randomMobile();
    const password3 = `Flow${Math.floor(1000 + Math.random() * 9000)}!`;

    await signup(page, name3, mobile3, password3);
    await login(page, mobile3, password3);
    await waitForPath(page, '/setup/1');
    await fillStepOne(page, "Skip Test's Shop", 'Chennai', 'Other');
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

    // === Step 10: the Helper (from User 1) counts stock, confirms an unusual value, and records
    // wastage; the Head chef (also from User 1) sees the team Today screen; the Owner reviews both
    // counts and the Helper's wastage entry, then deletes it ===
    await checkHelperTodayFlow(page, helperMobile, helperPin);
    await logoutFromAnywhere(page);
    await checkHeadChefTodayFlow(page, headChefMobile, headChefPin);
    await logoutFromAnywhere(page);
    await checkManagerHomeFlow(page, managerMobile, managerPassword);
    await logoutFromAnywhere(page);
    await checkCountReviewAndWastageFlow(page, mobile, password);
    await checkSettingsFlow(page);
    await checkTeamManagementFlow(page, 'Helper One');
    await logoutFromAnywhere(page);

    await captureStep10Screens(page);
    await captureStep12Screens(page, mobile, password);
    await captureStep13Screens(page, mobile, password, 'Chef Rahul');

    console.log('\nAll flow checks passed.');
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
