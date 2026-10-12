#!/usr/bin/env node
/**
 * Mobile-first responsive check (Step 8d). For every screen, at every width, asserts:
 *  - no horizontal overflow (anywhere in the DOM, not just the document root — react-native-web's
 *    ScrollView scrolls an inner div, not the page, so overflow can hide inside a nested container)
 *  - no interactive element smaller than 44px in either dimension (a labelled checkbox/radio is
 *    measured by its <label>, the real tap target, not the bare input)
 *  - no text smaller than 15px (16px for form inputs, to stop iOS Safari auto-zooming on focus)
 *  - nothing sitting underneath a sticky bottom bar once scrolled to the end of the content
 *
 * Prints a table of failures and saves one screenshot per screen/width to docs/screens/step8d/.
 * Used both to drive docs/RESPONSIVE_AUDIT.md (run before the Step 8d fixes) and as the ongoing
 * regression check (`npm run responsive`, run after — expected clean).
 *
 * Run with:  npm run responsive
 *
 * Requires the backend (:8000) and the Expo web dev server (:8081) already running. Starts its own
 * landing-page server on :8082 if nothing's already there (closed again at the end). Localhost only.
 * Never prints a password or PIN.
 */

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

import { ensureLandingServer } from './lib/landing_server.mjs';

const APP_URL = 'http://localhost:8081';
const LANDING_URL = 'http://localhost:8082';
const TIMEOUT = 15_000;
const SCREEN_DIR = 'docs/screens/step8d';
const WIDTHS = [320, 360, 390, 768, 1024, 1280, 1920];
const HEIGHT = 900;
const MIN_TOUCH = 44;
const MIN_TEXT = 15;
const MIN_INPUT_TEXT = 16;

function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) fail('no Chrome or Edge install found — set CHROME_PATH.');
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

// ---------- measurement ----------

async function measurePage(page) {
  return page.evaluate(
    ({ MIN_TOUCH, MIN_TEXT, MIN_INPUT_TEXT }) => {
      // Horizontal overflow can hide inside any nested scroller (react-native-web's ScrollView is an
      // inner div, not the document) — check every element, not just the document root. Two things
      // that look like overflow but aren't real problems:
      //  - an element with overflow-x:hidden/clip can report scrollWidth > clientWidth while clipping
      //    its own content perfectly well (e.g. a decorative shape intentionally bleeding off-edge,
      //    clipped by its own overflow:hidden) — that's not visible overflow, skip it.
      //  - documentElement/body's own clientWidth shrinks when a vertical scrollbar appears (classic
      //    non-overlay-scrollbar Chrome behaviour), making it look ~15-17px narrower than the real
      //    viewport even with zero actual overflow — compare those two against window.innerWidth
      //    instead, the true viewport width, not their own post-scrollbar clientWidth.
      const hOverflowList = [];
      for (const el of document.querySelectorAll('body, body *')) {
        const style = getComputedStyle(el);
        if (style.overflowX === 'hidden' || style.overflowX === 'clip') continue;
        const isRoot = el === document.body || el === document.documentElement;
        const compareWidth = isRoot ? window.innerWidth : el.clientWidth;
        if (el.scrollWidth > compareWidth + 2) {
          hOverflowList.push({
            tag: el.tagName,
            className: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
            scrollWidth: el.scrollWidth,
            clientWidth: compareWidth,
          });
          if (hOverflowList.length >= 3) break;
        }
      }

      const smallTargets = [];
      const seenTargets = new Set();
      document
        .querySelectorAll('[role="button"],[role="link"],[role="checkbox"],[role="radio"],a,button')
        .forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          // A labelled checkbox/radio's real tap target is its <label> (clicking the text toggles it
          // too) — measuring the bare input alone would flag a deliberately small visual glyph that
          // already has a much larger effective hit area.
          const label = el.closest('label');
          const useLabel = (el.getAttribute('role') === 'checkbox' || el.tagName === 'INPUT') && label;
          const target = useLabel ? label : el;
          const tr = target.getBoundingClientRect();
          if (tr.width < MIN_TOUCH || tr.height < MIN_TOUCH) {
            const text = (
              el.textContent ||
              el.getAttribute('aria-label') ||
              el.getAttribute('placeholder') ||
              ''
            )
              .trim()
              .slice(0, 40);
            const key = `${el.tagName}:${text}:${Math.round(tr.width)}x${Math.round(tr.height)}`;
            if (seenTargets.has(key)) return;
            seenTargets.add(key);
            smallTargets.push({ tag: el.tagName, text, w: Math.round(tr.width), h: Math.round(tr.height) });
          }
        });

      const smallText = [];
      const seenText = new Set();
      document.querySelectorAll('body *').forEach((el) => {
        // Deliberate exception, documented in docs/RESPONSIVE_AUDIT.md: the landing page's phone
        // mockups (the hero's ".phone" and the brand section's ".mini-phone") are miniature
        // illustrations of the real app, not readable body copy — enlarging their text would
        // change how the illustration looks, which this step's rules forbid touching. Captions
        // like ".mini-label" sit outside the mockup and are real copy, not exempted.
        if (el.closest('.phone, .mini-phone')) return;
        const hasDirectText = Array.from(el.childNodes).some(
          (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
        );
        if (!hasDirectText) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const size = parseFloat(getComputedStyle(el).fontSize);
        const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
        const min = isInput ? MIN_INPUT_TEXT : MIN_TEXT;
        if (size < min) {
          const text = el.textContent.trim().slice(0, 40);
          const key = `${el.tagName}:${text}:${size}`;
          if (seenText.has(key)) return;
          seenText.add(key);
          smallText.push({ tag: el.tagName, text, size: Math.round(size * 10) / 10 });
        }
      });

      // Sticky-bar occlusion: find a bottom-pinned absolutely-positioned element near the viewport's
      // bottom edge (the heuristic for "the sticky bar" — Screen.tsx's barWrap, or landing's .sticky),
      // scroll every scrollable container to its end, then confirm no other interactive element's
      // box overlaps the bar's vertical range.
      let barOcclusion = null;
      const barCandidates = Array.from(document.querySelectorAll('div')).filter((el) => {
        const style = getComputedStyle(el);
        // Require an explicit bottom:0 — Screen.tsx's barWrap sets this directly. Just being
        // visually near the bottom edge (e.g. absolutely-positioned decorative elements elsewhere
        // in the tree) isn't enough and produced false positives on screens with no bottom bar at
        // all (setup/done, /home — confirmed via the research pass: neither passes `bottomBar`).
        if ((style.position !== 'absolute' && style.position !== 'fixed') || style.bottom !== '0px') {
          return false;
        }
        const r = el.getBoundingClientRect();
        // A real sticky bar is a modest-height strip — excludes full-screen absolutely-positioned
        // containers (e.g. the app root) that also happen to compute bottom:0px by spanning the
        // whole viewport, which otherwise matched here and produced false positives on every screen.
        return r.width > 100 && r.height > 20 && r.height < 300;
      });
      if (barCandidates.length > 0) {
        const bar = barCandidates.reduce((a, b) =>
          b.getBoundingClientRect().width > a.getBoundingClientRect().width ? b : a,
        );
        const barRect = bar.getBoundingClientRect();
        document.querySelectorAll('*').forEach((el) => {
          const style = getComputedStyle(el);
          if (
            (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight + 2
          ) {
            el.scrollTop = el.scrollHeight;
          }
        });
        const interactive = document.querySelectorAll(
          '[role="button"],[role="link"],input,textarea,select,[role="checkbox"],[role="radio"]',
        );
        for (const el of interactive) {
          if (bar.contains(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.bottom > barRect.top + 2 && r.top < barRect.bottom) {
            barOcclusion = { tag: el.tagName, text: (el.textContent || '').trim().slice(0, 40) };
            break;
          }
        }
      }

      return { hOverflowList, smallTargets, smallText, barOcclusion };
    },
    { MIN_TOUCH, MIN_TEXT, MIN_INPUT_TEXT },
  );
}

// ---------- auth setup (reused across many width/route combinations) ----------

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

/** Drives a full signup through a finished wizard (one custom item per list step, one Manager and
 * one Helper on the team) so every list/preview has real content to check, not an empty state. */
async function buildOwnerSession(page) {
  const name = 'Responsive Check';
  const mobile = randomMobile();
  const password = `Resp${Math.floor(1000 + Math.random() * 9000)}!`;

  await signup(page, name, mobile, password);
  await waitForText(page, 'Account created. Log in to set up your business.');
  await login(page, mobile, password);
  await waitForPath(page, '/setup/1');

  await typeInto(page, 'Business name', "Lincy's Kitchen");
  await typeInto(page, 'City', 'Bangalore');
  await clickAndSettle(await findVisibleByText(page, 'radio', 'Cloud kitchen'));
  await clickButton(page, 'Next');
  await waitForPath(page, '/setup/2');

  await clickAndSettle(await findVisible(page, '[role="radio"][aria-label="#8E3B6E"]'));
  await clickButton(page, 'Next');
  await waitForPath(page, '/setup/3');

  await waitForText(page, 'Rice');
  await clickAndSettle(await findVisible(page, '[aria-label="Rice. kg"]'));
  await typeInto(page, 'Name', 'Fresh Paneer');
  await clickAndSettle(await findVisibleByText(page, 'radio', 'kg'));
  await clickButton(page, 'Add item');
  await waitForText(page, 'Fresh Paneer');
  await clickButton(page, 'Next');
  await waitForPath(page, '/setup/4');

  await waitForText(page, 'Add your own');
  await clickAndSettle(await findVisible(page, '[aria-label="Veg biryani"]'));
  await typeInto(page, 'Selling price', '120', { minCount: 2 });
  await typeInto(page, 'Name', 'Paneer Tikka', { last: true });
  await typeInto(page, 'Selling price', '180', { last: true });
  await clickAndSettle(await findVisibleByText(page, 'radio', 'Fresh Paneer'));
  await clickButton(page, 'Add item');
  await waitForText(page, 'Paneer Tikka');
  await clickButton(page, 'Next');
  await waitForPath(page, '/setup/5');

  const managerMobile = randomMobile();
  await typeInto(page, 'Name', 'Manoj Manager');
  await typeInto(page, 'Mobile number', managerMobile);
  await clickAndSettle(await findVisibleByText(page, 'radio', 'Manager'));
  await typeInto(page, 'Temporary password', 'Manager1234!');
  await clickButton(page, 'Add person');
  await waitForText(page, 'Manoj Manager');

  const helperMobile = randomMobile();
  const helperPin = '7392';
  await typeInto(page, 'Name', 'Helper One');
  await typeInto(page, 'Mobile number', helperMobile, { last: true });
  await clickAndSettle(await findVisibleByText(page, 'radio', 'Helper'));
  await typeInto(page, 'PIN', helperPin);
  await clickButton(page, 'Add person');
  await waitForText(page, 'Helper One');
  await clickButton(page, 'Next');
  await waitForPath(page, '/setup/6');

  await clickButton(page, 'Use recommended settings');
  await waitForPath(page, '/setup/done');
  await clickButton(page, 'Go to Home');
  await waitForPath(page, '/home');

  const tokens = await page.evaluate(() => ({
    access: localStorage.getItem('easykharcha.access'),
    refresh: localStorage.getItem('easykharcha.refresh'),
  }));
  return { tokens, helperMobile, helperPin };
}

async function buildHelperSession(browser, helperMobile, helperPin) {
  const page = await browser.newPage();
  // All pages in this browser share the same profile/localStorage per origin — without this, the
  // Owner's tokens (still there from buildOwnerSession) would sign this page straight into /home
  // before the login form ever gets a chance to render.
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await login(page, helperMobile, helperPin);
  await waitForPath(page, '/home');
  const tokens = await page.evaluate(() => ({
    access: localStorage.getItem('easykharcha.access'),
    refresh: localStorage.getItem('easykharcha.refresh'),
  }));
  await page.close();
  return tokens;
}

async function injectTokens(page, tokens) {
  await page.evaluateOnNewDocument((access, refresh) => {
    localStorage.setItem('easykharcha.access', access);
    localStorage.setItem('easykharcha.refresh', refresh);
  }, tokens.access, tokens.refresh);
}

// ---------- main ----------

async function checkRouteAtWidth(page, route, width, failures) {
  await page.setViewport({ width, height: HEIGHT });

  if (route.offline) {
    await page.goto(route.url, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await page.setOfflineMode(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
  } else {
    await page.goto(route.url, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  }
  await new Promise((resolve) => setTimeout(resolve, 300));

  const result = await measurePage(page);
  await mkdir(SCREEN_DIR, { recursive: true });
  await page.screenshot({ path: `${SCREEN_DIR}/${route.name}-${width}.png` });

  if (route.offline) await page.setOfflineMode(false);

  for (const o of result.hOverflowList) {
    failures.push({
      route: route.name,
      width,
      kind: 'horizontal overflow',
      detail: `<${o.tag.toLowerCase()} class="${o.className}"> scrollWidth=${o.scrollWidth} clientWidth=${o.clientWidth}`,
    });
  }
  for (const t of result.smallTargets) {
    failures.push({
      route: route.name,
      width,
      kind: 'touch target < 44px',
      detail: `<${t.tag.toLowerCase()}> "${t.text}" ${t.w}x${t.h}`,
    });
  }
  for (const t of result.smallText) {
    failures.push({
      route: route.name,
      width,
      kind: 'text too small',
      detail: `<${t.tag.toLowerCase()}> "${t.text}" ${t.size}px`,
    });
  }
  if (result.barOcclusion) {
    failures.push({
      route: route.name,
      width,
      kind: 'hidden behind sticky bar',
      detail: `<${result.barOcclusion.tag.toLowerCase()}> "${result.barOcclusion.text}"`,
    });
  }
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  await mkdir(SCREEN_DIR, { recursive: true });
  const landingServer = await ensureLandingServer(8082);
  const failures = [];

  try {
    const setupPage = await browser.newPage();
    // Tall so every field is reachable without scrolling — the sticky bottom bar and
    // react-native-web's internal ScrollView both make driving a short viewport unreliable (see
    // flow.mjs, which hit the same thing first).
    await setupPage.setViewport({ width: 390, height: 3000 });
    console.log('Setting up an Owner session with real wizard data...');
    const { tokens: ownerTokens, helperMobile, helperPin } = await buildOwnerSession(setupPage);
    await setupPage.close();
    console.log('Setting up a Helper session...');
    const helperTokens = await buildHelperSession(browser, helperMobile, helperPin);
    console.log('Sessions ready. Checking every route at every width...\n');

    const noAuthRoutes = [
      { name: 'landing', url: `${LANDING_URL}/` },
      { name: 'login', url: `${APP_URL}/login` },
      { name: 'signup', url: `${APP_URL}/signup` },
      { name: 'not-found', url: `${APP_URL}/this-page-does-not-exist` },
      { name: 'offline-login', url: `${APP_URL}/login`, offline: true },
    ];
    const ownerRoutes = [
      { name: 'setup-1', url: `${APP_URL}/setup/1` },
      { name: 'setup-2', url: `${APP_URL}/setup/2` },
      { name: 'setup-3', url: `${APP_URL}/setup/3` },
      { name: 'setup-4', url: `${APP_URL}/setup/4` },
      { name: 'setup-5', url: `${APP_URL}/setup/5` },
      { name: 'setup-6', url: `${APP_URL}/setup/6` },
      { name: 'setup-done', url: `${APP_URL}/setup/done` },
      { name: 'home-owner', url: `${APP_URL}/home` },
    ];
    const helperRoutes = [{ name: 'home-helper', url: `${APP_URL}/home` }];

    const noAuthPage = await browser.newPage();
    // All pages in this browser share the same profile/localStorage per origin — without this, the
    // Owner's tokens (still there from buildOwnerSession) would silently redirect /login straight to
    // /home before its content ever rendered, hiding whatever this page actually needs to check.
    await noAuthPage.evaluateOnNewDocument(() => localStorage.clear());
    for (const route of noAuthRoutes) {
      for (const width of WIDTHS) {
        console.log(`  ${route.name.padEnd(14)} ${width}px`);
        await checkRouteAtWidth(noAuthPage, route, width, failures);
      }
    }
    await noAuthPage.close();

    const ownerPage = await browser.newPage();
    await injectTokens(ownerPage, ownerTokens);
    for (const route of ownerRoutes) {
      for (const width of WIDTHS) {
        console.log(`  ${route.name.padEnd(14)} ${width}px`);
        await checkRouteAtWidth(ownerPage, route, width, failures);
      }
    }
    await ownerPage.close();

    const helperPage = await browser.newPage();
    await injectTokens(helperPage, helperTokens);
    for (const route of helperRoutes) {
      for (const width of WIDTHS) {
        console.log(`  ${route.name.padEnd(14)} ${width}px`);
        await checkRouteAtWidth(helperPage, route, width, failures);
      }
    }
    await helperPage.close();

    console.log('');
    if (failures.length === 0) {
      console.log('All responsive checks passed — no failures at any width.');
    } else {
      console.log(`${failures.length} failure(s):\n`);
      console.log('route           width  kind                        detail');
      console.log('-'.repeat(100));
      for (const f of failures) {
        console.log(
          `${f.route.padEnd(15)} ${String(f.width).padEnd(6)} ${f.kind.padEnd(27)} ${f.detail}`,
        );
      }
      process.exitCode = 1;
    }
  } catch (err) {
    const pages = await browser.pages();
    const page = pages.at(-1);
    if (page) {
      await mkdir(SCREEN_DIR, { recursive: true });
      await page.screenshot({ path: `${SCREEN_DIR}/_failure.png` }).catch(() => {});
      console.error('URL at failure:', page.url());
    }
    throw err;
  } finally {
    await browser.close();
    if (landingServer) landingServer.close();
  }
}

main().catch((err) => fail(err.stack ?? String(err)));
