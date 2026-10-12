#!/usr/bin/env node
/**
 * Drives a real browser against the actual running app (not direct API calls, unlike smoke.py) to
 * prove the frontend and backend are wired together end to end.
 *
 * Four scenarios:
 *  1. A fresh user: signup -> login -> all six wizard steps (step 2's colour preview checked live;
 *     step 5 adds a Helper with a PIN; step 6 uses the recommended settings) -> /setup/done (no
 *     "Still to do") -> /home (no "Finish setting up" card, onboarding is fully done) -> log out ->
 *     log in again -> lands on /home.
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
 * Requires both dev servers already running — backend on :8000, Expo web on :8081 — and leaves them
 * running afterwards. Localhost only. Never prints a PIN or password — only pass/fail.
 */

import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const APP_URL = 'http://localhost:8081';
const TIMEOUT = 15_000;

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

async function skipStep(page, fromStep, toPath) {
  await clickButton(page, 'Skip for now');
  await waitForPath(page, toPath);
  console.log(`OK — skipped step ${fromStep}.`);
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });

  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => fail(`a JS error occurred in the page: ${err}`));
    // Tall enough that every field on every wizard screen fits without scrolling — sidesteps both
    // react-native-web's internally-scrolling ScrollView (native scrollIntoView is a no-op for it)
    // and the sticky BottomActionBar occluding whatever sits directly above it.
    await page.setViewport({ width: 390, height: 3000 });

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
    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/6');
    console.log('OK — added a Helper with a PIN, step 5 saved, moved to /setup/6.');

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

    await logoutFromAnywhere(page);

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

    // === Scenario 4: the Helper (from User 1) logs in with their PIN, sees no setup links ===
    await login(page, helperMobile, helperPin);
    await waitForPath(page, '/home');
    const helperHomeText = await page.evaluate(() => document.body.innerText);
    if (helperHomeText.includes('Finish setting up')) {
      fail('a Helper should never see the "Finish setting up" checklist card');
    }
    console.log('OK — the Helper logs in with their PIN and /home has no setup links.');

    console.log('\nAll flow checks passed.');
  } catch (err) {
    const page = (await browser.pages()).at(-1);
    if (page) {
      await page.screenshot({ path: 'docs/screens/step7/_flow_failure.png' }).catch(() => {});
      console.error('URL at failure:', page.url());
    }
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => fail(err.stack ?? String(err)));
