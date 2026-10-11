#!/usr/bin/env node
/**
 * Drives a real browser against the actual running app (not direct API calls, unlike smoke.py) to
 * prove the frontend and backend are wired together end to end: signup -> redirected to login with
 * the success banner -> login -> /setup/1 -> /setup/2 (pick a colour, preview updates) -> "Setup
 * saved" -> log out -> log in again -> lands on /home (onboarding is done). A second, independent
 * user does just step 1, logs out mid-wizard, and logs back in to confirm they resume at /setup/2.
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

async function waitForPath(page, path) {
  await page.waitForFunction(
    (expected) => window.location.pathname === expected,
    { timeout: TIMEOUT },
    path,
  );
}

async function waitForText(page, text) {
  await page.waitForFunction(
    (expected) => document.body.innerText.includes(expected),
    { timeout: TIMEOUT },
    text,
  );
}

// expo-router's web Stack keeps previous screens mounted (hidden, zero-size) rather than
// unmounting them on navigation, so a plain querySelector/textContent match can silently hit a
// stale duplicate left over from an earlier screen. Everything below filters to an element that
// actually has layout (width/height > 0) before touching it.
async function findVisibleByAttribute(page, selector) {
  const handle = await page.waitForFunction(
    (sel) => {
      const candidates = Array.from(document.querySelectorAll(sel));
      return (
        candidates.find((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }) ?? null
      );
    },
    { timeout: TIMEOUT },
    selector,
  );
  return handle.asElement();
}

async function findVisibleByText(page, role, text) {
  const handle = await page.waitForFunction(
    (expectedRole, expectedText) => {
      const candidates = Array.from(document.querySelectorAll(`[role="${expectedRole}"]`));
      return (
        candidates.find((el) => {
          if (el.textContent?.trim() !== expectedText) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }) ?? null
      );
    },
    { timeout: TIMEOUT },
    role,
    text,
  );
  return handle.asElement();
}

async function clickButton(page, label) {
  const element = await findVisibleByText(page, 'button', label);
  await element.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await element.click();
}

async function typeInto(page, label, text) {
  const element = await findVisibleByAttribute(page, `[aria-label="${label}"]`);
  await element.click({ clickCount: 3 });
  await element.type(text);
}

async function readValue(page, label) {
  const element = await findVisibleByAttribute(page, `[aria-label="${label}"]`);
  return element.evaluate((el) => el.value);
}

async function signup(page, name, mobile, password) {
  await page.goto(`${APP_URL}/signup`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await typeInto(page, 'Your name', name);
  await typeInto(page, 'Mobile number', mobile);
  await typeInto(page, 'Password', password);
  const consent = await findVisibleByAttribute(page, '[role="checkbox"]');
  await consent.click();
  await clickButton(page, 'Create account');
  await waitForPath(page, '/login');
}

async function login(page, mobile, password) {
  await typeInto(page, 'Mobile number', mobile);
  await typeInto(page, 'Password', password);
  await clickButton(page, 'Log in');
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });

  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => fail(`a JS error occurred in the page: ${err}`));
    await page.setViewport({ width: 390, height: 844 });

    // --- Primary user: full flow through both wizard steps ---
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

    await typeInto(page, 'Business name', "Anita's Kitchen");
    await typeInto(page, 'City', 'Pune');
    const typeOption = await findVisibleByText(page, 'radio', 'Cloud kitchen');
    await typeOption.click();
    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/2');
    console.log('OK — step 1 saved, moved to /setup/2.');

    const swatch = await findVisibleByAttribute(page, '[role="radio"][aria-label="#8E3B6E"]');
    await swatch.click();
    await waitForFunctionOnPreview(page, '#8E3B6E');
    console.log("OK — picking a colour updates the live preview.");

    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/saved');
    await waitForText(page, 'Setup saved');
    console.log('OK — step 2 saved, "Setup saved" shown.');

    await clickButton(page, 'Go to Home');
    await waitForPath(page, '/home');
    await clickButton(page, 'Log out');
    await waitForPath(page, '/login');
    await login(page, mobile, password);
    await waitForPath(page, '/home');
    console.log('OK — after finishing both steps, logging back in lands on /home.');

    // /login redirects a signed-in user straight to /home, so the first user must be signed out
    // before the second user can even reach the signup/login forms.
    await clickButton(page, 'Log out');
    await waitForPath(page, '/login');

    // --- Second, independent user: stop after step 1, confirm resume at /setup/2 ---
    const name2 = 'Resume Test';
    const mobile2 = randomMobile();
    const password2 = `Flow${Math.floor(1000 + Math.random() * 9000)}!`;

    await signup(page, name2, mobile2, password2);
    await login(page, mobile2, password2);
    await waitForPath(page, '/setup/1');

    await typeInto(page, 'Business name', "Resume Test's Bakery");
    await typeInto(page, 'City', 'Mumbai');
    const typeOption2 = await findVisibleByText(page, 'radio', 'Bakery or sweets');
    await typeOption2.click();
    await clickButton(page, 'Next');
    await waitForPath(page, '/setup/2');

    // /setup/2 itself has no logout button (only the wizard controls) — go to /home, which does,
    // to log out. Resuming depends only on the business's saved onboarding_step, not on which
    // screen happened to be open, so this is still a faithful "left mid-wizard" scenario.
    await page.goto(`${APP_URL}/home`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await clickButton(page, 'Log out');
    await waitForPath(page, '/login');
    await login(page, mobile2, password2);
    await waitForPath(page, '/setup/2');
    console.log('OK — leaving mid-wizard after step 1 and logging back in resumes at /setup/2.');

    console.log('\nAll flow checks passed.');
  } catch (err) {
    const page = (await browser.pages()).at(-1);
    if (page) {
      await page.screenshot({ path: 'docs/screens/step5/_flow_failure.png' }).catch(() => {});
      console.error('URL at failure:', page.url());
    }
    throw err;
  } finally {
    await browser.close();
  }
}

async function waitForFunctionOnPreview(page, expectedHex) {
  await page.waitForFunction(
    (hex) => {
      const target = hex
        .match(/#(..)(..)(..)/)
        .slice(1)
        .map((h) => parseInt(h, 16));
      const el = Array.from(document.querySelectorAll('*')).find(
        (e) => e.textContent?.trim() === "Anita's Kitchen" && e.children.length === 0,
      );
      if (!el || !el.parentElement) return false;
      const bg = getComputedStyle(el.parentElement).backgroundColor;
      const match = bg.match(/rgb\((\d+), (\d+), (\d+)\)/);
      if (!match) return false;
      const [, r, g, b] = match.map(Number);
      return r === target[0] && g === target[1] && b === target[2];
    },
    { timeout: TIMEOUT },
    expectedHex,
  );
}

main().catch((err) => fail(err.stack ?? String(err)));
