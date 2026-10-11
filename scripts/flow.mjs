#!/usr/bin/env node
/**
 * Drives a real browser against the actual running app (not direct API calls, unlike smoke.py) to
 * prove the frontend and backend are wired together end to end.
 *
 * Three scenarios:
 *  1. A fresh user: signup -> login -> /setup/1 -> /setup/2 (colour preview updates live) ->
 *     /setup/3 (tick two starter items, add one own item with "Goes off" + shelf life) ->
 *     /setup/4 (tick one starter item, add one own item linked to a stock item) -> "Setup saved" ->
 *     log out -> log in again -> lands on /home (onboarding is done).
 *  2. A second, independent user who stops after step 1, logs out mid-wizard, and logs back in to
 *     confirm they resume at /setup/2.
 *  3. A third, independent user who fills steps 1-2 then skips both 3 and 4, and confirms "Setup
 *     saved" lists both as skipped.
 *
 * Run with:  npm run flow
 *
 * Requires both dev servers already running — backend on :8000, Expo web on :8081 — and leaves them
 * running afterwards. Localhost only.
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
// that pattern hung intermittently on screens with many interactive elements; $$()  plus a
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
  const consent = await findVisible(page, '[role="checkbox"]');
  await consent.click();
  await clickButton(page, 'Create account');
  await waitForPath(page, '/login');
}

async function login(page, mobile, password) {
  await typeInto(page, 'Mobile number', mobile);
  await typeInto(page, 'Password', password);
  await clickButton(page, 'Log in');
}

async function fillStepOne(page, businessName, city, typeLabel) {
  await typeInto(page, 'Business name', businessName);
  await typeInto(page, 'City', city);
  const typeOption = await findVisibleByText(page, 'radio', typeLabel);
  await typeOption.click();
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

async function main() {
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });

  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => fail(`a JS error occurred in the page: ${err}`));
    // Tall enough that every field on every wizard screen fits without scrolling — sidesteps both
    // react-native-web's internally-scrolling ScrollView (native scrollIntoView is a no-op for it)
    // and the sticky BottomActionBar occluding whatever sits directly above it.
    await page.setViewport({ width: 390, height: 3000 });

    // === User 1: full flow through all four wizard steps built so far ===
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

    const swatch = await findVisible(page, '[role="radio"][aria-label="#8E3B6E"]');
    await swatch.click();
    await waitForPreviewColour(page, "Anita's Kitchen", '#8E3B6E');
    console.log('OK — picking a colour updates the live preview.');

    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/3');
    console.log('OK — step 2 saved, moved to /setup/3.');

    await waitForText(page, 'Rice');
    (await findVisible(page, '[aria-label="Rice. kg"]')).click();
    (await findVisible(page, '[aria-label="Cooking oil. L"]')).click();
    console.log('OK — ticked two starter stock items.');

    await typeInto(page, 'Name', 'Fresh Paneer');
    (await findVisibleByText(page, 'radio', 'kg')).click();
    (await findVisible(page, '[aria-label="Goes off"]')).click();
    await typeInto(page, 'Shelf life in days', '3');
    await clickButton(page, 'Add item');
    await waitForText(page, 'Fresh Paneer');
    console.log('OK — added one own stock item with Goes off + shelf life.');

    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/4');
    console.log('OK — step 3 saved, moved to /setup/4.');

    await waitForText(page, 'Add your own');
    (await findVisible(page, '[aria-label="Veg biryani"]')).click();
    // minCount: 2 — the starter item's inline price box only mounts once the tick above is
    // reflected in a render; without waiting for both fields to exist, this can resolve to the
    // "add your own" form's price field instead (the only one present in the first instant).
    await typeInto(page, 'Selling price', '120', { minCount: 2 });
    console.log('OK — ticked one starter sell item and set a price.');

    await typeInto(page, 'Name', 'Paneer Tikka', { last: true });
    await typeInto(page, 'Selling price', '180', { last: true });
    (await findVisibleByText(page, 'radio', 'Fresh Paneer')).click();
    await clickButton(page, 'Add item');
    await waitForText(page, 'Paneer Tikka');
    console.log('OK — added one own sell item linked to a stock item.');

    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/saved');
    await waitForText(page, 'Setup saved');
    console.log('OK — step 4 saved, "Setup saved" shown.');

    await clickButton(page, 'Go to Home');
    await waitForPath(page, '/home');
    await clickButton(page, 'Log out');
    await waitForPath(page, '/login');
    await login(page, mobile, password);
    await waitForPath(page, '/home');
    console.log('OK — after finishing all four steps, logging back in lands on /home.');

    // /login redirects a signed-in user straight to /home, so each user must be signed out before
    // the next one can even reach the signup/login forms.
    await clickButton(page, 'Log out');
    await waitForPath(page, '/login');

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
    await page.goto(`${APP_URL}/home`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await clickButton(page, 'Log out');
    await waitForPath(page, '/login');
    await login(page, mobile2, password2);
    await waitForPath(page, '/setup/2');
    console.log('OK — leaving mid-wizard after step 1 and logging back in resumes at /setup/2.');

    await page.goto(`${APP_URL}/home`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await clickButton(page, 'Log out');
    await waitForPath(page, '/login');

    // === User 3: fill steps 1-2, skip both 3 and 4, confirm the skipped list ===
    const name3 = 'Skip Test';
    const mobile3 = randomMobile();
    const password3 = `Flow${Math.floor(1000 + Math.random() * 9000)}!`;

    await signup(page, name3, mobile3, password3);
    await login(page, mobile3, password3);
    await waitForPath(page, '/setup/1');
    await fillStepOne(page, "Skip Test's Shop", 'Chennai', 'Other');
    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/3');

    await clickButton(page, 'Skip for now');
    await waitForPath(page, '/setup/4');
    console.log('OK — skipped step 3.');

    await clickButton(page, 'Skip for now');
    await waitForPath(page, '/setup/saved');
    console.log('OK — skipped step 4.');

    await waitForText(page, 'Skipped for now');
    await waitForText(page, 'What you buy');
    await waitForText(page, 'What you sell');
    console.log('OK — "Setup saved" lists both skipped steps.');

    console.log('\nAll flow checks passed.');
  } catch (err) {
    const page = (await browser.pages()).at(-1);
    if (page) {
      await page.screenshot({ path: 'docs/screens/step6/_flow_failure.png' }).catch(() => {});
      console.error('URL at failure:', page.url());
    }
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => fail(err.stack ?? String(err)));
