/**
 * Drives the web client in a real browser and fails on any console error or unhandled rejection.
 *
 * `npx tsc --noEmit` and a successful Metro bundle both pass on code that crashes the moment it runs —
 * a mis-resolved CommonJS/ESM dependency compiles perfectly and then throws `x is not a function`.
 * This script is the only check that actually executes the app.
 *
 *   node scripts/smoke-ui.mjs                 # needs the Expo and Django servers running
 *   node scripts/smoke-ui.mjs --headful       # watch it
 *
 * Uses puppeteer-core against an already-installed Chrome/Edge, so there is no Chromium download.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'screenshots');
const APP = process.env.APP_URL ?? 'http://localhost:8081';
const HEADFUL = process.argv.includes('--headful');

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/** Expo's dev overlay and React's error logging both surface here; neither is worth tolerating. */
const IGNORE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /favicon/i,
  /useNativeDriver/i,
];

const problems = [];
const steps = [];

function note(ok, label, extra = '') {
  steps.push({ ok, label, extra });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
}

const executablePath = BROWSERS.find((path) => existsSync(path));
if (!executablePath) {
  console.error('No Chrome or Edge found. Set one of the paths in BROWSERS.');
  process.exit(2);
}
if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: !HEADFUL,
  args: ['--no-sandbox', '--window-size=430,932'],
  defaultViewport: { width: 430, height: 932, isMobile: true, hasTouch: true },
});

const page = await browser.newPage();

page.on('console', (message) => {
  if (message.type() !== 'error' && message.type() !== 'warning') return;
  const text = message.text();
  if (IGNORE.some((pattern) => pattern.test(text))) return;
  if (message.type() === 'error') problems.push(`console.error: ${text}`);
});
page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
page.on('requestfailed', (request) => {
  const url = request.url();
  if (url.includes('/api/')) problems.push(`request failed: ${url} (${request.failure()?.errorText})`);
});

const shot = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
const text = () => page.evaluate(() => document.body.innerText);

async function waitForText(needle, timeout = 30000) {
  await page.waitForFunction(
    (value) => document.body.innerText.includes(value),
    { timeout },
    needle,
  );
}

/**
 * Wait until the screen has actually finished fetching.
 *
 * Every screen shows a "Loading…" spinner while react-query is in flight. Asserting on body text
 * before that clears reads an empty screen and reports a passing app as broken — which is exactly
 * what the first version of this script did.
 */
async function waitForLoaded(timeout = 40000) {
  await page.waitForFunction(() => !document.body.innerText.includes('Loading'), { timeout });
  await new Promise((resolve) => setTimeout(resolve, 400));
}

async function typeInto(label, value) {
  // <Field> renders <View><Text>label</Text><TextInput/></View>, so the input's *immediate* parent
  // holds exactly one label. Walking any further up reaches the Card, which contains every label on
  // the screen and matches the wrong input.
  const handle = await page.evaluateHandle((wanted) => {
    const inputs = [...document.querySelectorAll('input, textarea')];
    return inputs.find((input) =>
      (input.parentElement?.innerText ?? '').toLowerCase().includes(wanted.toLowerCase()),
    );
  }, label);
  const element = handle.asElement();
  if (!element) throw new Error(`No input found for label "${label}"`);
  await element.click({ clickCount: 3 });
  await element.type(value, { delay: 10 });

  // Assert what actually landed in the field. The first version of this helper silently typed the PIN
  // into the phone box, and the run failed 30 seconds later with a useless timeout.
  const got = await element.evaluate((node) => node.value);
  if (got !== value) throw new Error(`"${label}" holds "${got}", expected "${value}"`);
}

async function clickText(label) {
  const clicked = await page.evaluate((wanted) => {
    const nodes = [...document.querySelectorAll('div[role="button"], button, [tabindex]')];
    const target = nodes.find((node) => node.innerText?.trim().toLowerCase() === wanted.toLowerCase())
      ?? nodes.find((node) => node.innerText?.toLowerCase().includes(wanted.toLowerCase()));
    if (!target) return false;
    target.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`No clickable element matching "${label}"`);
  await new Promise((resolve) => setTimeout(resolve, 900));
}

try {
  console.log(`\nDriving ${APP} in ${executablePath.split(/[\\/]/).pop()}\n`);

  console.log('=== boot ===');
  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 120000 });
  await waitForText('EasyKharcha', 60000);
  await shot('01-login');
  note(true, 'app boots to the sign-in screen');

  const bootText = await text();
  note(!/is not a function|Uncaught Error|Unable to resolve/i.test(bootText), 'no error overlay on boot');

  console.log('\n=== sign in as the Owner ===');
  await typeInto('Phone number', '9000000001');
  await typeInto('PIN', '1234');
  await clickText('Sign in');
  await waitForText('DEMO Kitchen', 30000);
  await waitForLoaded();
  await shot('02-owner-home');
  note(true, 'owner reaches the home dashboard');

  const home = await text();
  note(home.includes('Week to date'), 'week-to-date card rendered');
  note(/Kitchen efficiency/i.test(home), 'kitchen efficiency card rendered');
  note(/331/.test(home), 'unexplained loss of ₹331.20 shown', home.match(/₹[\d,.]+/g)?.join(' ') ?? '');
  note(
    (await page.$$eval('a[role="tab"], [role="tab"]', (tabs) => tabs.length)) <= 5,
    'tab bar holds five tabs or fewer',
    `${await page.$$eval('[role="tab"]', (tabs) => tabs.map((t) => t.innerText.trim()).join(', '))}`,
  );

  console.log('\n=== report and variance ===');
  await clickText('Report');
  await waitForText('Revenue', 30000);
  await waitForLoaded();
  await shot('03-report');
  note(true, 'report screen renders');

  await clickText('Variance');
  await waitForText('Expected vs actual', 20000);
  await waitForLoaded();
  await shot('04-variance');
  const variance = await text();
  note(/3\.48/.test(variance), 'expected 3.480 in the variance table');
  note(/4\.7/.test(variance), 'actual 4.700 in the variance table');
  note(/0\.92/.test(variance), 'unexplained 0.920 in the variance table');

  console.log('\n=== stock capture ===');
  await clickText('Stock');
  await waitForText('Daily stock', 20000);
  await waitForLoaded();
  await shot('05-stock');
  note(true, 'stock screen renders');
  // No blind-count assertion here: an Owner *may* see variance, and the alert banner on every entry
  // screen legitimately carries it. The blind rule applies to Staff and Head Chef — asserted below.

  console.log('\n=== sign out, back in as the Head Chef ===');
  await clickText('More');
  await waitForText('Sign out', 20000);
  await clickText('Sign out');
  await waitForText('Know what you bought', 20000);

  await typeInto('Phone number', '9000000003');
  await typeInto('PIN', '1234');
  await clickText('Sign in');
  await waitForText('DEMO Kitchen', 30000);
  await waitForLoaded();
  await shot('06-chef-home');

  const chef = await text();
  note(/today.s tasks/i.test(chef), 'chef sees the capture task list');
  note(
    !/revenue|cost %|unexplained|variance|efficiency/i.test(chef),
    'chef home shows no sales or variance (blind count)',
  );
  const chefTabs = await page.$$eval('[role="tab"]', (tabs) =>
    tabs.map((tab) => tab.innerText.trim()),
  );
  note(!chefTabs.includes('Report'), 'no Report tab for the chef', chefTabs.join(', '));
  note(!chefTabs.includes('Sales'), 'no Sales tab for the chef');

  // The tab bar was 62 pt tall and sliced every label in half. Assert the label's box sits inside
  // the bar rather than eyeballing a screenshot.
  const clipped = await page.evaluate(() => {
    const bar = document.querySelector('[role="tablist"]');
    if (!bar) return 'no tablist';
    const barBottom = bar.getBoundingClientRect().bottom;
    return [...bar.querySelectorAll('[role="tab"]')]
      .map((tab) => {
        const label = [...tab.querySelectorAll('div, span')].pop();
        const box = label?.getBoundingClientRect();
        return box && box.bottom > barBottom + 0.5 ? (label.innerText || '').trim() : null;
      })
      .filter(Boolean);
  });
  note(Array.isArray(clipped) && clipped.length === 0, 'no tab label overflows the tab bar',
    Array.isArray(clipped) && clipped.length ? `clipped: ${clipped.join(', ')}` : '');

  await clickText('More');
  await waitForText('Record', 20000);
  await shot('07-chef-more');
  const chefMore = await text();
  note(!/Report|Audit|Trends/.test(chefMore), 'chef More offers no reporting screens');

  console.log('\n=== chef entry screens stay blind ===');
  await clickText('Stock');
  await waitForText('Daily stock', 20000);
  await waitForLoaded();
  await shot('08-chef-stock');
  const chefStock = await text();
  note(
    !/expected|variance|unexplained|revenue|cost %/i.test(chefStock),
    'chef stock screen reveals no expected figure or variance',
  );

  await clickText('Wastage');
  await waitForText('Wastage', 20000);
  await waitForLoaded();
  const chefWastage = await text();
  note(
    !/variance|unexplained|revenue|plates/i.test(chefWastage),
    'chef wastage screen reveals no sales or variance',
  );
} catch (error) {
  problems.push(`script: ${error.message}`);
  await shot('99-failure').catch(() => {});
} finally {
  await browser.close();
}

console.log('\n==============================');
const failed = steps.filter((step) => !step.ok).length;
console.log(`steps: ${steps.length - failed} passed, ${failed} failed`);
if (problems.length) {
  console.log(`\n${problems.length} runtime problem(s):`);
  for (const problem of [...new Set(problems)]) console.log(`  - ${problem}`);
}
console.log(`screenshots: ${SHOTS}`);
process.exit(failed || problems.length ? 1 : 0);
