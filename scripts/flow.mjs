#!/usr/bin/env node
/**
 * Drives a real browser against the actual running app (not direct API calls, unlike smoke.py) to
 * prove the frontend and backend are wired together end to end: signup -> redirected to login with
 * the success banner -> login -> /home shows the name -> log out -> back at /login.
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
  await page.waitForFunction((expected) => window.location.pathname === expected, { timeout: TIMEOUT }, path);
}

async function waitForText(page, text) {
  await page.waitForFunction(
    (expected) => document.body.innerText.includes(expected),
    { timeout: TIMEOUT },
    text,
  );
}

async function clickButton(page, label) {
  const handle = await page.waitForFunction(
    (expected) => {
      const candidates = Array.from(document.querySelectorAll('[role="button"], [role="link"]'));
      return candidates.find((el) => el.textContent?.trim() === expected) ?? null;
    },
    { timeout: TIMEOUT },
    label,
  );
  const element = handle.asElement();
  if (!element) fail(`could not find a button or link labelled "${label}"`);
  await element.click();
}

async function typeInto(page, label, text) {
  const selector = `[aria-label="${label}"]`;
  await page.waitForSelector(selector, { timeout: TIMEOUT });
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, text);
}

async function main() {
  const name = 'Flow Test';
  const mobile = randomMobile();
  const password = `Flow${Math.floor(1000 + Math.random() * 9000)}!`;

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
  });

  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => fail(`a JS error occurred in the page: ${err}`));
    await page.setViewport({ width: 390, height: 844 });

    await page.goto(`${APP_URL}/signup`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await typeInto(page, 'Your name', name);
    await typeInto(page, 'Mobile number', mobile);
    await typeInto(page, 'Password', password);

    const consent = await page.waitForSelector('[role="checkbox"]', { timeout: TIMEOUT });
    await consent.click();

    await clickButton(page, 'Create account');
    console.log('OK — signup submitted.');

    await waitForPath(page, '/login');
    await waitForText(page, 'Account created. Log in to set up your business.');
    console.log('OK — redirected to /login with the success banner.');

    const mobileValue = await page.$eval('[aria-label="Mobile number"]', (el) => el.value);
    if (mobileValue !== mobile) {
      fail(`login's mobile field is not pre-filled: expected ${mobile}, got ${mobileValue}`);
    }
    console.log('OK — mobile number pre-filled on /login.');

    await typeInto(page, 'Password', password);
    await clickButton(page, 'Log in');

    await waitForPath(page, '/home');
    await waitForText(page, `Hello, ${name}`);
    console.log('OK — logged in, /home shows the name.');

    await clickButton(page, 'Log out');
    await waitForPath(page, '/login');
    console.log('OK — logged out, back at /login.');

    console.log('\nAll flow checks passed.');
  } finally {
    await browser.close();
  }
}

main().catch((err) => fail(err.stack ?? String(err)));
