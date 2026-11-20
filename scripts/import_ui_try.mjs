#!/usr/bin/env node
/**
 * Dev helper (Step S4e): walks the whole Import invoice flow in a real browser with NO AI cost.
 * Needs the backend (:8000) started with AI_FAKE=true and the Expo web app (:8081) running. The
 * backend's AI_FAKE_DEFAULT_FIXTURE (default fomo_14753) supplies the bill reading, so this signs up a
 * fresh owner through the API, gives them the four items that bill contains, then drives the UI:
 * choose a photo -> use it -> wait for the read -> review -> confirm -> success -> Recent invoices ->
 * invoice detail. Prints what it saw; exits non-zero at the first thing that is not as expected.
 *
 * Run with:  node scripts/import_ui_try.mjs
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = process.env.APP_URL ?? 'http://localhost:8081';
const API = process.env.API_URL ?? 'http://127.0.0.1:8000/api/v1';
const SAMPLE = path.join(ROOT, 'docs', 'images', 'ek_logo_icon.png');

function findChrome() {
  const found = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((p) => existsSync(p));
  const chosen = process.env.CHROME_PATH ?? found;
  if (!chosen) throw new Error('No Chrome or Edge found; set CHROME_PATH.');
  return chosen;
}

async function api(method, route, body, token) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:8081',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${route} -> ${response.status} ${JSON.stringify(data)}`);
  return data;
}

function expect(ok, message) {
  if (!ok) {
    console.error(`NOT AS EXPECTED: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`OK - ${message}`);
}

async function text(page) {
  return page.evaluate(() => document.body.innerText);
}

async function waitForText(page, wanted, timeout = 60_000) {
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, wanted);
  } catch (err) {
    const seen = (await text(page)).replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`Never saw "${wanted}" at ${page.url()}. The page said: ${seen}`);
  }
}

async function clickText(page, label) {
  const handle = await page.waitForSelector(`::-p-xpath(//*[normalize-space(text())="${label}"])`, {
    timeout: 30_000,
  });
  await handle.click();
}

async function main() {
  const mobile = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const password = `Kharcha${Math.floor(Math.random() * 9000 + 1000)}!`;
  await api('POST', '/auth/signup/', {
    name: 'Import Try',
    business_name: 'Import Try Biz',
    mobile,
    password,
    consent: true,
  });
  const { access, refresh } = await api('POST', '/auth/login/', { mobile, secret: password });
  const me = await api('GET', '/me/', null, access);
  const businessId = me.businesses[0].id;
  await api('PATCH', `/businesses/${businessId}/`, { business_type: 'cloud_kitchen', city: 'Pune' }, access).catch(() => {});
  const stock = await api('POST', `/businesses/${businessId}/stock-items/bulk/`, { items: [{ name: 'Milk', unit: 'L' }] }, access);
  for (const [name, price] of [
    ['Fire Pork', '380'],
    ['Mutton Keema Panni Puri', '320'],
    ['Water Bottle', '20'],
    ['Mixed Fried Rice', '300'],
  ]) {
    await api(
      'POST',
      `/businesses/${businessId}/sell-items/`,
      { name, selling_price: price, ingredients: [{ stock_item: stock[0].id, quantity: '0.1' }] },
      access,
    );
  }
  console.log(`Signed up ${mobile}; business ${businessId} has the four items of bill 14753.`);

  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 800 });
    await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.evaluate(
      (a, r) => {
        localStorage.setItem('easykharcha.access', a);
        localStorage.setItem('easykharcha.refresh', r);
      },
      access,
      refresh,
    );
    await page.goto(`${APP}/import-invoice?returnTo=home`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await waitForText(page, 'Choose photo', 120_000);
    expect((await text(page)).includes('Tips for a clear bill'), 'the Import invoice start screen shows the tips');

    const [chooser] = await Promise.all([page.waitForFileChooser(), clickText(page, 'Choose photo')]);
    await chooser.accept([SAMPLE]);
    await waitForText(page, 'Use this photo');
    expect(true, 'a photo can be chosen and previewed');
    await clickText(page, 'Use this photo');

    await waitForText(page, 'Review your bill', 90_000);
    let body = await text(page);
    expect(body.includes('Fire Pork') && body.includes('Matched to: Fire Pork'), 'the review shows the read lines matched to my items');
    expect(body.includes('From your bill') && body.includes('Bill total'), 'totals are labelled "From your bill"');
    expect(body.includes('SGST') && body.includes('CGST'), 'the printed tax lines are shown, not recomputed');
    expect(body.includes('Payment (optional)'), 'the optional payment card is on the review screen');
    expect(body.includes('Duplicate / Copy'), 'the Duplicate/Copy stamp is flagged');
    expect(body.includes('Add 4 items to'), 'the confirm button counts the 4 items');

    await clickText(page, body.match(/Add 4 items to [^\n]*/)[0].trim());
    await waitForText(page, 'Sale added', 60_000);
    body = await text(page);
    expect(body.includes('From a bill') && body.includes('EK_'), 'success shows the invoice with the "From a bill" badge');
    expect(!body.includes('Send on WhatsApp') && !body.includes('Print invoice'), 'no WhatsApp or print for an imported invoice');

    await page.goto(`${APP}/invoices`, { waitUntil: 'domcontentloaded' });
    await waitForText(page, 'Bill 14753');
    body = await text(page);
    expect(body.includes('From a bill') && body.includes('Any source'), 'Recent invoices lists it as "From a bill" with the source chips');

    await clickText(page, 'Bill 14753');
    await waitForText(page, 'Bill number');
    body = await text(page);
    expect(body.includes('14753') && body.includes('Bill photo'), 'the invoice detail shows the printed bill number and the bill photo');
    expect(!body.includes('Send on WhatsApp'), 'the imported invoice detail has no WhatsApp button');
    console.log('Done. The whole import flow ran in the browser.');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
