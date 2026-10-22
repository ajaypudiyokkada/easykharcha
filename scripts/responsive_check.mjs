#!/usr/bin/env node
/**
 * Mobile-first responsive check (Step 8d, strengthened in Step 11). For every screen — and every
 * bottom sheet / dialog, not just routes — at every width, asserts:
 *  - no horizontal overflow (anywhere in the DOM, not just the document root — react-native-web's
 *    ScrollView scrolls an inner div, not the page, so overflow can hide inside a nested container)
 *  - no interactive element clipped by the viewport OR by any ancestor with overflow hidden/auto/
 *    scroll/clip (Step 11: the opposite of this script's old behaviour of skipping those ancestors
 *    entirely — that blind spot is exactly what let a clipped "Price per unit" field inside a
 *    Sheet's ScrollView ship undetected; see docs/GAP_LIST.md bug 4)
 *  - no text narrower than 40px holding more than 6 characters (the one-char-per-line symptom of a
 *    squeezed flex row — see docs/GAP_LIST.md bug 3)
 *  - no text clipped (scrollWidth > clientWidth) by its own overflow:hidden with no ellipsis style
 *  - no interactive element smaller than 44px in either dimension (a labelled checkbox/radio is
 *    measured by its <label>, the real tap target, not the bare input)
 *  - no text smaller than 15px (16px for form inputs, to stop iOS Safari auto-zooming on focus)
 *  - nothing sitting underneath a sticky bottom bar once scrolled to the end of the content
 *
 * Prints a table of failures and saves one screenshot per screen/width (and per sheet/dialog/width)
 * to docs/screens/step8d/. Used both to drive docs/RESPONSIVE_AUDIT.md (run before the Step 8d
 * fixes) and as the ongoing regression check (`npm run responsive`, run after — expected clean).
 *
 * Run with:  npm run responsive
 * Self-test the clipping check itself (injects a known-clipped input, confirms the check catches
 * it, then removes it — proves the check can actually fail):  node scripts/responsive_check.mjs --self-test
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
const API_BASE = 'http://127.0.0.1:8000/api/v1';
const TIMEOUT = 15_000;
const SCREEN_DIR = 'docs/screens/step8d';
const WIDTHS = [320, 360, 390, 768, 1024, 1280, 1920];
// The exact set Step 11 asks sheets/dialogs to be checked at — a subset of WIDTHS, kept separate
// so adding a sheet check doesn't multiply runtime by the desktop-only route widths too.
const SHEET_WIDTHS = [320, 360, 390, 768, 1280];
const HEIGHT = 900;
const MIN_TOUCH = 44;
const MIN_TEXT = 15;
const MIN_INPUT_TEXT = 16;
const MIN_TEXT_BOX = 40;
const MAX_CHARS_IN_NARROW_BOX = 6;

// ---------- screen tiering (--screen <name>, --list) ----------

/** Every route/sheet name this script checks, grouped by which session it needs — kept here as a
 * flat manifest (rather than derived from the route/sheet arrays built further down, which only
 * exist after session setup) so `--list` and the tier-skipping below don't need a session built
 * first. `main()` asserts this stays in sync with the real arrays the first time it builds them. */
const SCREEN_MANIFEST = {
  none: ['landing', 'login', 'signup', 'not-found', 'offline-login'],
  owner: [
    'setup-1', 'setup-2', 'setup-3', 'setup-4', 'setup-5', 'setup-6', 'setup-done', 'home-owner',
    'buy', 'buy-detail', 'stock', 'stock-detail', 'reports', 'reports-30d', 'sales', 'wastage',
    'alerts', 'alert-detail', 'team', 'team-detail', 'settings', 'settings-business',
    'settings-brand', 'settings-stock', 'settings-sell', 'settings-alerts', 'count', 'counts',
    'counts-detail',
    'sheet-profile', 'sheet-record-purchase', 'sheet-record-purchase-edit', 'sheet-record-wastage',
    'dialog-delete-purchase', 'dialog-delete-wastage', 'sheet-more-menu', 'sheet-prepare-reminder',
    'sheet-edit-stock-item', 'sheet-edit-sell-item', 'sheet-add-team-member', 'sheet-reset-pin',
    'dialog-remove-member', 'sheet-record-sales', 'dialog-delete-sales',
  ],
  helper: ['home-helper', 'wastage-helper', 'sheet-profile-helper', 'sheet-record-wastage-helper'],
  headchef: ['home-headchef'],
};

// Only these owner screens need seedLateClosingCountAndWastage's seeded closing count/wastage/
// sale/alert data to render something real — every other owner screen is fine (and much faster to
// reach) against the plain wizard-only state `--screen` builds for a single-screen run.
const SEED_DEPENDENT_SCREENS = ['alert-detail', 'sheet-prepare-reminder', 'dialog-delete-wastage', 'dialog-delete-sales'];

function tierFor(screen) {
  for (const [tier, names] of Object.entries(SCREEN_MANIFEST)) {
    if (names.includes(screen)) return tier;
  }
  return null;
}

function parseResponsiveArgs() {
  const args = process.argv.slice(2);
  const screenIdx = args.indexOf('--screen');
  return {
    screen: screenIdx !== -1 ? args[screenIdx + 1] : null,
    list: args.includes('--list'),
    selfTest: args.includes('--self-test'),
  };
}

function listResponsiveScreens() {
  console.log('Responsive screens (npm run responsive -- --screen <name>):\n');
  for (const [tier, names] of Object.entries(SCREEN_MANIFEST)) {
    console.log(`  ${tier}:`);
    for (const name of names) console.log(`    ${name}`);
  }
  console.log(
    '\n--screen builds only the session tier that screen needs (none/owner/helper/headchef) — ' +
      'a\n"none" screen needs no signup at all; an "owner" screen still needs the wizard-built ' +
      'business\nbut skips the helper/head-chef logins and (except for alert-detail/sheet-' +
      'prepare-reminder/\ndialog-delete-wastage/dialog-delete-sales) the seeded closing count/' +
      'wastage/sale/alert data.',
  );
}

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
    ({ MIN_TOUCH, MIN_TEXT, MIN_INPUT_TEXT, MIN_TEXT_BOX, MAX_CHARS_IN_NARROW_BOX }) => {
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

      // Per-control clipping: the opposite of hOverflowList's overflow-hidden skip above. Every
      // visible interactive element must lie fully inside the viewport (horizontally — vertical
      // scrolling past the fold is normal) AND fully inside every ancestor whose overflow-x is
      // hidden/auto/scroll/clip, which is exactly the class of bug the old script's blanket skip
      // let through (a Sheet's ScrollView sets overflow-x:hidden while scrolling vertically, and
      // silently clipped a too-wide form row inside it).
      const clippedControls = [];
      const seenClipped = new Set();
      document
        .querySelectorAll('input,select,textarea,button,a,[role="button"],[role="link"]')
        .forEach((el) => {
          if (el.closest('.phone, .mini-phone')) return;
          // tabindex="-1" means "not a real tab stop" — the landing page's spam-trap honeypot field
          // (deliberately parked off-screen at left:-9999px to catch bots, never shown to a real
          // visitor) is the one case of this in the app; a genuinely clipped control is always a
          // real tab stop.
          if (el.getAttribute('tabindex') === '-1') return;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          const text = (
            el.textContent ||
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            ''
          )
            .trim()
            .slice(0, 40);

          function report(by, extra) {
            const key = `${el.tagName}:${text}:${by}`;
            if (seenClipped.has(key)) return;
            seenClipped.add(key);
            clippedControls.push({ tag: el.tagName, text, by, ...extra });
          }

          if (r.left < -2 || r.right > window.innerWidth + 2) {
            report('viewport', { left: Math.round(r.left), right: Math.round(r.right), bound: window.innerWidth });
            return;
          }

          let node = el.parentElement;
          while (node && node !== document.body) {
            const style = getComputedStyle(node);
            if (['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowX)) {
              const ar = node.getBoundingClientRect();
              if (r.left < ar.left - 2 || r.right > ar.right + 2) {
                report('ancestor', {
                  ancestorTag: node.tagName,
                  ancestorClass: typeof node.className === 'string' ? node.className.slice(0, 40) : '',
                });
                break;
              }
            }
            node = node.parentElement;
          }
        });

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
      const narrowTextOverflow = [];
      const seenNarrow = new Set();
      const hiddenOverflowText = [];
      const seenHiddenOverflow = new Set();
      document.querySelectorAll('body *').forEach((el) => {
        // Deliberate exception, documented in docs/RESPONSIVE_AUDIT.md: the landing page's phone
        // mockups (the hero's ".phone" and the brand section's ".mini-phone") are miniature
        // illustrations of the real app, not readable body copy — enlarging their text would
        // change how the illustration looks, which this step's rules forbid touching. Captions
        // like ".mini-label" sit outside the mockup and are real copy, not exempted.
        if (el.closest('.phone, .mini-phone')) return;
        // Step 16: another deliberate, scoped exception — BarChart/LineChart axis ticks (the SVG
        // <text> y-axis values, and the x-axis date/item labels marked with the shared
        // CHART_AXIS_TEXT_ID) are 12px per the Reports chart spec, not the site's usual 15px body
        // floor. Dense numeric ticks packed along an axis, not copy a shopkeeper reads directly —
        // the chart's own takeaway/legend/table text all stay at the normal 15px+ and are still
        // checked below like anything else.
        if (el.closest('svg') || el.id === 'chart-axis-label') return;
        const hasDirectText = Array.from(el.childNodes).some(
          (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
        );
        if (!hasDirectText) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const text = el.textContent.trim();
        const size = parseFloat(getComputedStyle(el).fontSize);
        const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
        const min = isInput ? MIN_INPUT_TEXT : MIN_TEXT;
        if (size < min) {
          const key = `${el.tagName}:${text.slice(0, 40)}:${size}`;
          if (!seenText.has(key)) {
            seenText.add(key);
            smallText.push({ tag: el.tagName, text: text.slice(0, 40), size: Math.round(size * 10) / 10 });
          }
        }

        // One-char-per-line symptom (docs/GAP_LIST.md bug 3): a text box squeezed to near-zero
        // width by a flex-row sibling still has room for each individual character, one per line.
        if (r.width < MIN_TEXT_BOX && text.length > MAX_CHARS_IN_NARROW_BOX) {
          const key = `${el.tagName}:${text.slice(0, 40)}`;
          if (!seenNarrow.has(key)) {
            seenNarrow.add(key);
            narrowTextOverflow.push({ tag: el.tagName, text: text.slice(0, 40), width: Math.round(r.width) });
          }
        }

        // Clipped by its own overflow:hidden with no ellipsis — readable-looking but actually
        // truncated mid-word, with no visual cue that anything is missing.
        const elStyle = getComputedStyle(el);
        if (
          (elStyle.overflowX === 'hidden' || elStyle.overflow === 'hidden') &&
          elStyle.textOverflow !== 'ellipsis' &&
          el.scrollWidth > el.clientWidth + 2
        ) {
          const key = `${el.tagName}:${text.slice(0, 40)}`;
          if (!seenHiddenOverflow.has(key)) {
            seenHiddenOverflow.add(key);
            hiddenOverflowText.push({
              tag: el.tagName,
              text: text.slice(0, 40),
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
            });
          }
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
      const bar = barCandidates.reduce(
        (a, b) =>
          !a || b.getBoundingClientRect().width > a.getBoundingClientRect().width ? b : a,
        null,
      );
      // A Sheet/ConfirmDialog panel is painted on top of the page behind it (including the real
      // sticky nav bar, still in the DOM but now visually covered) — their rects can still overlap
      // geometrically even though the panel is the one actually on top. Confirm "the bar" is really
      // the topmost thing at its own location before trusting any overlap with it.
      const barOnTop =
        bar &&
        (() => {
          const r = bar.getBoundingClientRect();
          const topEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return Boolean(topEl) && (bar === topEl || bar.contains(topEl));
        })();
      if (bar && barOnTop) {
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

      return {
        hOverflowList,
        clippedControls,
        smallTargets,
        smallText,
        narrowTextOverflow,
        hiddenOverflowText,
        barOcclusion,
      };
    },
    { MIN_TOUCH, MIN_TEXT, MIN_INPUT_TEXT, MIN_TEXT_BOX, MAX_CHARS_IN_NARROW_BOX },
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
/** Pushes this business's opening-count deadline late in the day (same trick seedLateClosingCountAndWastage
 * uses in reverse, further down) so the opening count buildOwnerSession is about to submit stays
 * "not_started" (not already "late") regardless of what time of day this script happens to run —
 * otherwise /count would silently render the *closing* form instead once the default 11 AM
 * deadline has passed, and the count-review click below would never find its row. day_starts_hour:
 * 0 keeps the business date the plain calendar date too, so overnight (between midnight and the
 * real default day_starts_hour of 5) "today" isn't already yesterday's business date with its
 * 23:00 deadline already passed (which would unlock/route to closing instead of opening). */
async function keepOpeningCountNotLate(page) {
  const access = await page.evaluate(() => localStorage.getItem('easykharcha.access'));
  const me = await apiRequest('/me/', { token: access });
  const businessId = me.body.businesses[0].id;
  await apiRequest(`/businesses/${businessId}/settings/`, {
    method: 'PATCH',
    token: access,
    body: { day_starts_hour: 0, count_deadline_hour: 23 },
  });
}

async function buildOwnerSession(page) {
  const name = 'Responsive Check';
  const mobile = randomMobile();
  const password = `Resp${Math.floor(1000 + Math.random() * 9000)}!`;

  await signup(page, name, mobile, password);
  await waitForText(page, 'Account created. Log in to set up your business.');
  await login(page, mobile, password);
  await waitForPath(page, '/setup/1');

  await typeInto(page, 'Business name', "Lincy's Kitchen");
  // 560034 (Bengaluru/Koramangala) — the pincode lookup fills in State and City.
  await typeInto(page, 'Pincode', '560034');
  await waitForText(page, 'Karnataka');
  await clickAndSettle(await findVisibleByText(page, 'radio', 'Cloud kitchen'));
  await clickButton(page, 'Next');
  await waitForPath(page, '/setup/2');

  await clickAndSettle(await findVisible(page, '[role="radio"][aria-label="#8E3B6E"]'));
  await clickButton(page, 'Next');
  await waitForPath(page, '/setup/3');

  // Step 20: the starter picker's groups are collapsed by default (cloud kitchen has 9) — expand
  // "Groceries & dry goods" to reach Rice, same as flow.mjs's main scenario.
  await waitForText(page, 'Pick from common items');
  await clickAndSettle(await findVisible(page, '[aria-label^="Groceries & dry goods ("]'));
  await clickAndSettle(await findVisible(page, '[aria-label="Rice. kg"]'));
  await typeInto(page, 'Name', 'Fresh Paneer');
  await clickAndSettle(await findVisibleByText(page, 'radio', 'kg'));
  await clickButton(page, 'Add to list');
  await waitForText(page, 'Fresh Paneer');
  await clickButton(page, '2 selected — Next');
  await waitForPath(page, '/setup/4');

  // Step 22a: the wizard's quick dish form is name/price/portion/group only, no ingredient picker —
  // Paneer Tikka lands here with no recipe; attaching one is Settings' "Add a dish" job instead.
  await waitForText(page, 'Add your own');
  await clickAndSettle(await findVisible(page, '[aria-label="Veg biryani"]'));
  await typeInto(page, 'Selling price', '120', { minCount: 2 });
  await typeInto(page, 'Name', 'Paneer Tikka', { last: true });
  await typeInto(page, 'Selling price', '180', { last: true });
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

  // Step 10
  const headChefMobile = randomMobile();
  const headChefPin = '8417';
  await typeInto(page, 'Name', 'Chef Rahul', { last: true });
  await typeInto(page, 'Mobile number', headChefMobile, { last: true });
  // This business is "Cloud kitchen" — sectorCopy.json's roleLabels shows it as "Head cook".
  await clickAndSettle(await findVisibleByText(page, 'radio', 'Head cook'));
  await typeInto(page, 'PIN', headChefPin, { last: true });
  await clickButton(page, 'Add person');
  await waitForText(page, 'Chef Rahul');

  await clickButton(page, 'Next');
  await waitForPath(page, '/setup/6');

  await clickButton(page, 'Use recommended settings');
  await waitForPath(page, '/setup/done');
  await clickButton(page, 'Go to Home');
  await waitForPath(page, '/home');

  // Step 9: record one purchase, so /buy/[id] and /stock/[id] have a real page to check too.
  await page.goto(`${APP_URL}/buy`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Purchases');
  await clickButton(page, 'Record purchase');
  await waitForText(page, 'What did you buy?');
  await typeInto(page, 'Supplier', 'Sunrise Supplies');
  await clickAndSettle(await findVisibleByText(page, 'radio', 'Rice'));
  await typeInto(page, 'Quantity', '2');
  await typeInto(page, 'Price per unit', '40');
  await clickButton(page, 'Save purchase');
  await waitForText(page, 'Purchase saved');
  await waitForText(page, 'Sunrise Supplies');
  await (await findVisible(page, '[aria-label="Sunrise Supplies"]')).click();
  await waitForText(page, 'Purchase detail');
  const purchasePath = await page.evaluate(() => location.pathname);

  await page.goto(`${APP_URL}/stock`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Rice');
  await (await findVisible(page, '[aria-label="Rice"]')).click();
  await waitForText(page, 'Price trend');
  const stockItemPath = await page.evaluate(() => location.pathname);

  // Step 10: the opening stock count, so /counts and /counts/[id] have a real page to check too.
  await keepOpeningCountNotLate(page);
  await page.goto(`${APP_URL}/count`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  // Step 23d: this business's first-ever count is framed "Starting stock", not "Count stock".
  await waitForText(page, 'Starting stock');
  await typeInto(page, 'Rice quantity', '5');
  await typeInto(page, 'Fresh Paneer quantity', '5');
  await clickButton(page, 'Save count');
  await waitForText(page, 'Count saved. Thank you.');
  await clickButton(page, 'Back to Today');
  await waitForPath(page, '/home');

  await page.goto(`${APP_URL}/counts`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, "Today's counts");
  await (await findVisible(page, '[aria-label="Opening count · Responsive Check"]')).click();
  await waitForText(page, 'Count detail');
  const countDetailPath = await page.evaluate(() => location.pathname);

  // Step 13: Team member detail, so /team/[id] has a real page to check too.
  await page.goto(`${APP_URL}/team`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await waitForText(page, 'Team');
  await (await findVisible(page, '[aria-label="Helper One"]')).click();
  await waitForText(page, 'Team member');
  const teamMemberPath = await page.evaluate(() => location.pathname);

  const tokens = await page.evaluate(() => ({
    access: localStorage.getItem('easykharcha.access'),
    refresh: localStorage.getItem('easykharcha.refresh'),
  }));
  return {
    tokens,
    ownerName: name,
    helperMobile,
    helperPin,
    headChefMobile,
    headChefPin,
    purchasePath,
    stockItemPath,
    countDetailPath,
    teamMemberPath,
  };
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

async function buildHeadChefSession(browser, headChefMobile, headChefPin) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await login(page, headChefMobile, headChefPin);
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

// ---------- seed data for the sheet/dialog checks (direct API calls, same endpoints smoke.py uses) ----------

async function apiRequest(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** So the counts-review "Remind" button (and its reminder sheet — the thing Step 11 fixes) has
 * something real to open, and so the wastage delete dialog has a real row to delete: pushes
 * closing_count_hour to 0 (same trick smoke.py uses) so the closing count about to be submitted is
 * late, submits it with the same quantities as the opening count (so the unusual-value guard never
 * fires), then records one wastage entry. All via the same endpoints the UI itself calls — not a
 * new backend feature, just driving existing ones directly instead of through a form. */
async function seedLateClosingCountAndWastage(accessToken) {
  const me = await apiRequest('/me/', { token: accessToken });
  const businessId = me.body.businesses[0].id;

  const settingsRes = await apiRequest(`/businesses/${businessId}/settings/`, {
    method: 'PATCH',
    token: accessToken,
    body: { closing_count_hour: 0 },
  });
  if (settingsRes.status !== 200) {
    throw new Error(`seed: set closing_count_hour failed, got ${settingsRes.status} (${JSON.stringify(settingsRes.body)})`);
  }

  const form = await apiRequest(`/businesses/${businessId}/counts/form/?type=closing`, { token: accessToken });
  const items = form.body.items;
  const lines = items.map((item) => ({ stock_item: item.id, state: 'counted', counted_qty: '5' }));
  const countRes = await apiRequest(`/businesses/${businessId}/counts/`, {
    method: 'POST',
    token: accessToken,
    body: { type: 'closing', lines },
  });
  if (countRes.status !== 201) {
    throw new Error(`seed: closing count failed, got ${countRes.status} (${JSON.stringify(countRes.body)})`);
  }

  const wastageRes = await apiRequest(`/businesses/${businessId}/wastage/`, {
    method: 'POST',
    token: accessToken,
    body: { stock_item: items[0].id, quantity: '1', reason: 'spillage', note: '' },
  });
  if (wastageRes.status !== 201) {
    throw new Error(`seed: wastage entry failed, got ${wastageRes.status} (${JSON.stringify(wastageRes.body)})`);
  }

  // Step 14: one sale today, so the Sales screen's delete dialog has a real row to open. IST is
  // UTC+5:30 — plain `new Date().toISOString()` gives the UTC date, which still lags a whole
  // calendar day behind IST for the first 5.5 hours after midnight IST; the business's own "today"
  // (and where the Sales screen looks for it) is always IST-local, not UTC.
  const sellItems = await apiRequest(`/businesses/${businessId}/sell-items/`, { token: accessToken });
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const saleRes = await apiRequest(`/businesses/${businessId}/sales/`, {
    method: 'POST',
    token: accessToken,
    body: {
      business_date: today,
      lines: [{ sell_item: sellItems.body[0].id, quantity: '1' }],
    },
  });
  if (saleRes.status !== 201) {
    throw new Error(`seed: sale failed, got ${saleRes.status} (${JSON.stringify(saleRes.body)})`);
  }

  // Step 15: price_rise (two purchases at 60, then one at 70 — default rate_creep_pct is 10) and
  // wastage_high (buy 20 kg, waste 2 kg — default wastage_alert_pct is 5), so the Alerts screen,
  // its detail route and the profile sheet all have something real to check.
  const paneerId = items.find((item) => item.name === 'Fresh Paneer')?.id ?? items[1].id;
  for (const price of ['60', '60', '70']) {
    const res = await apiRequest(`/businesses/${businessId}/purchases/`, {
      method: 'POST',
      token: accessToken,
      body: {
        supplier_name: 'Dairy Co',
        purchase_date_time: new Date().toISOString(),
        lines: [
          { stock_item: paneerId, quantity: '5', unit_price: price, line_total: String(5 * Number(price)) },
        ],
      },
    });
    if (res.status !== 201) {
      throw new Error(`seed: paneer purchase at ${price} failed, got ${res.status} (${JSON.stringify(res.body)})`);
    }
  }

  const riceId = items[0].id;
  const riceBuyRes = await apiRequest(`/businesses/${businessId}/purchases/`, {
    method: 'POST',
    token: accessToken,
    body: {
      supplier_name: 'Grain Co',
      purchase_date_time: new Date().toISOString(),
      lines: [{ stock_item: riceId, quantity: '20', unit_price: '40', line_total: '800' }],
    },
  });
  if (riceBuyRes.status !== 201) {
    throw new Error(`seed: rice purchase failed, got ${riceBuyRes.status} (${JSON.stringify(riceBuyRes.body)})`);
  }
  const riceWasteRes = await apiRequest(`/businesses/${businessId}/wastage/`, {
    method: 'POST',
    token: accessToken,
    body: { stock_item: riceId, quantity: '2', reason: 'spillage', note: '' },
  });
  if (riceWasteRes.status !== 201) {
    throw new Error(`seed: rice wastage failed, got ${riceWasteRes.status} (${JSON.stringify(riceWasteRes.body)})`);
  }

  const alertsRes = await apiRequest(`/businesses/${businessId}/alerts/`, { token: accessToken });
  if (alertsRes.status !== 200 || alertsRes.body.results.length === 0) {
    throw new Error(`seed: expected at least one alert, got ${alertsRes.status} (${JSON.stringify(alertsRes.body)})`);
  }
  return { alertKey: alertsRes.body.results[0].key };
}

// ---------- main ----------

function recordFailures(name, width, result, failures) {
  for (const o of result.hOverflowList) {
    failures.push({
      route: name,
      width,
      kind: 'horizontal overflow',
      detail: `<${o.tag.toLowerCase()} class="${o.className}"> scrollWidth=${o.scrollWidth} clientWidth=${o.clientWidth}`,
    });
  }
  for (const c of result.clippedControls ?? []) {
    const detail =
      c.by === 'viewport'
        ? `<${c.tag.toLowerCase()}> "${c.text}" clipped by viewport (left=${c.left} right=${c.right} viewport=${c.bound})`
        : `<${c.tag.toLowerCase()}> "${c.text}" clipped by <${c.ancestorTag.toLowerCase()} class="${c.ancestorClass}"> (overflow ancestor)`;
    failures.push({ route: name, width, kind: 'control clipped', detail });
  }
  for (const t of result.smallTargets) {
    failures.push({
      route: name,
      width,
      kind: 'touch target < 44px',
      detail: `<${t.tag.toLowerCase()}> "${t.text}" ${t.w}x${t.h}`,
    });
  }
  for (const t of result.smallText) {
    failures.push({
      route: name,
      width,
      kind: 'text too small',
      detail: `<${t.tag.toLowerCase()}> "${t.text}" ${t.size}px`,
    });
  }
  for (const t of result.narrowTextOverflow ?? []) {
    failures.push({
      route: name,
      width,
      kind: 'one-char-per-line text',
      detail: `<${t.tag.toLowerCase()}> "${t.text}" box width=${t.width}px`,
    });
  }
  for (const t of result.hiddenOverflowText ?? []) {
    failures.push({
      route: name,
      width,
      kind: 'text clipped, no ellipsis',
      detail: `<${t.tag.toLowerCase()}> "${t.text}" scrollWidth=${t.scrollWidth} clientWidth=${t.clientWidth}`,
    });
  }
  if (result.barOcclusion) {
    failures.push({
      route: name,
      width,
      kind: 'hidden behind sticky bar',
      detail: `<${result.barOcclusion.tag.toLowerCase()}> "${result.barOcclusion.text}"`,
    });
  }
}

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

  recordFailures(route.name, width, result, failures);
}

/** Opens a bottom sheet / dialog fresh at each width (navigate, open, measure, screenshot) rather
 * than resizing with it already open — simpler, and avoids any state carried over between widths.
 * `sheet.open(page)` must leave the sheet/dialog visible and settled before returning. */
async function checkSheetAtWidth(page, sheet, width, failures) {
  await page.setViewport({ width, height: HEIGHT });
  await page.goto(sheet.url, { waitUntil: 'networkidle0', timeout: TIMEOUT });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await sheet.open(page);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const result = await measurePage(page);
  await mkdir(SCREEN_DIR, { recursive: true });
  await page.screenshot({ path: `${SCREEN_DIR}/${sheet.name}-${width}.png` });

  recordFailures(sheet.name, width, result, failures);
}

async function main() {
  const { screen, list } = parseResponsiveArgs();
  if (list) {
    listResponsiveScreens();
    return;
  }
  const tier = screen ? tierFor(screen) : null;
  if (screen && !tier) {
    fail(`unknown screen "${screen}" — run with --list to see valid names.`);
  }
  const needOwner = !screen || tier !== 'none';
  const needHelper = !screen || tier === 'helper';
  const needHeadChef = !screen || tier === 'headchef';
  const needSeed = !screen || SEED_DEPENDENT_SCREENS.includes(screen);

  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  await mkdir(SCREEN_DIR, { recursive: true });
  const landingServer = await ensureLandingServer(8082);
  const failures = [];
  const timings = [];

  async function timedCheck(name, fn) {
    const t0 = Date.now();
    await fn();
    timings.push([name, (Date.now() - t0) / 1000]);
  }

  try {
    let ownerTokens, ownerName, helperMobile, helperPin, headChefMobile, headChefPin;
    let purchasePath = '', stockItemPath = '', countDetailPath = '', teamMemberPath = '';
    let helperTokens = null, headChefTokens = null;
    let alertDetailPath = '';

    if (needOwner) {
      const setupPage = await browser.newPage();
      // Tall so every field is reachable without scrolling — the sticky bottom bar and
      // react-native-web's internal ScrollView both make driving a short viewport unreliable (see
      // flow.mjs, which hit the same thing first).
      await setupPage.setViewport({ width: 390, height: 3000 });
      console.log('Setting up an Owner session with real wizard data...');
      ({
        tokens: ownerTokens,
        ownerName,
        helperMobile,
        helperPin,
        headChefMobile,
        headChefPin,
        purchasePath,
        stockItemPath,
        countDetailPath,
        teamMemberPath,
      } = await buildOwnerSession(setupPage));
      await setupPage.close();
    }
    if (needHelper) {
      console.log('Setting up a Helper session...');
      helperTokens = await buildHelperSession(browser, helperMobile, helperPin);
    }
    if (needHeadChef) {
      console.log('Setting up a Head chef session...');
      headChefTokens = await buildHeadChefSession(browser, headChefMobile, headChefPin);
    }
    if (needOwner && needSeed) {
      console.log('Seeding a late closing count, wastage and alert-triggering data...');
      const { alertKey } = await seedLateClosingCountAndWastage(ownerTokens.access);
      alertDetailPath = `/alerts/${encodeURIComponent(alertKey)}`;
    }
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
      // Step 9
      { name: 'buy', url: `${APP_URL}/buy` },
      { name: 'buy-detail', url: `${APP_URL}${purchasePath}` },
      { name: 'stock', url: `${APP_URL}/stock` },
      { name: 'stock-detail', url: `${APP_URL}${stockItemPath}` },
      // Step 16
      { name: 'reports', url: `${APP_URL}/reports` },
      { name: 'reports-30d', url: `${APP_URL}/reports?period=30d` },
      { name: 'sales', url: `${APP_URL}/sales` },
      { name: 'wastage', url: `${APP_URL}/wastage` },
      { name: 'alerts', url: `${APP_URL}/alerts` },
      { name: 'alert-detail', url: `${APP_URL}${alertDetailPath}` },
      { name: 'team', url: `${APP_URL}/team` },
      { name: 'team-detail', url: `${APP_URL}${teamMemberPath}` },
      { name: 'settings', url: `${APP_URL}/settings` },
      // Step 12
      { name: 'settings-business', url: `${APP_URL}/settings/business` },
      { name: 'settings-brand', url: `${APP_URL}/settings/brand` },
      { name: 'settings-stock', url: `${APP_URL}/settings/stock` },
      { name: 'settings-sell', url: `${APP_URL}/settings/sell` },
      { name: 'settings-alerts', url: `${APP_URL}/settings/alerts` },
      // Step 10
      { name: 'count', url: `${APP_URL}/count` },
      { name: 'counts', url: `${APP_URL}/counts` },
      { name: 'counts-detail', url: `${APP_URL}${countDetailPath}` },
    ];
    const helperRoutes = [
      { name: 'home-helper', url: `${APP_URL}/home` },
      { name: 'wastage-helper', url: `${APP_URL}/wastage` },
    ];
    const headChefRoutes = [{ name: 'home-headchef', url: `${APP_URL}/home` }];

    // Sanity net: catches this manifest ever drifting from the real route/sheet names below.
    const allNoAuthNames = noAuthRoutes.map((r) => r.name);
    if (JSON.stringify(allNoAuthNames) !== JSON.stringify(SCREEN_MANIFEST.none)) {
      fail(`SCREEN_MANIFEST.none is out of sync with noAuthRoutes: ${allNoAuthNames}`);
    }

    if (!screen || tier === 'none') {
      const noAuthPage = await browser.newPage();
      // All pages in this browser share the same profile/localStorage per origin — without this,
      // the Owner's tokens (still there from buildOwnerSession) would silently redirect /login
      // straight to /home before its content ever rendered, hiding whatever this page needs to check.
      await noAuthPage.evaluateOnNewDocument(() => localStorage.clear());
      for (const route of screen ? noAuthRoutes.filter((r) => r.name === screen) : noAuthRoutes) {
        for (const width of WIDTHS) {
          console.log(`  ${route.name.padEnd(14)} ${width}px`);
          await timedCheck(`${route.name}@${width}`, () =>
            checkRouteAtWidth(noAuthPage, route, width, failures),
          );
        }
      }
      await noAuthPage.close();
    }

    const ownerPage = await browser.newPage();
    if (needOwner) {
      await injectTokens(ownerPage, ownerTokens);
      for (const route of screen ? ownerRoutes.filter((r) => r.name === screen) : ownerRoutes) {
        for (const width of WIDTHS) {
          console.log(`  ${route.name.padEnd(14)} ${width}px`);
          await timedCheck(`${route.name}@${width}`, () =>
            checkRouteAtWidth(ownerPage, route, width, failures),
          );
        }
      }
    }

    // Step 11: every bottom sheet / dialog, not just routes — opened fresh at each width.
    console.log('\nChecking sheets and dialogs at every width...\n');
    const ownerSheets = [
      // Step 15
      {
        name: 'sheet-profile',
        url: `${APP_URL}/home`,
        open: async (page) => {
          await clickAndSettle(await findVisible(page, '[aria-label="Open profile menu"]'));
        },
      },
      {
        name: 'sheet-record-purchase',
        url: `${APP_URL}/buy`,
        open: async (page) => {
          await waitForText(page, 'Purchases');
          await clickButton(page, 'Record purchase');
          await waitForText(page, 'What did you buy?');
        },
      },
      {
        name: 'sheet-record-purchase-edit',
        url: `${APP_URL}${purchasePath}`,
        open: async (page) => {
          await waitForText(page, 'Purchase detail');
          await clickButton(page, 'Edit purchase');
          await waitForText(page, 'Edit purchase');
        },
      },
      {
        name: 'sheet-record-wastage',
        url: `${APP_URL}/wastage`,
        open: async (page) => {
          await waitForText(page, 'Wastage');
          await clickButton(page, 'Record wastage');
          await waitForText(page, 'What was lost?');
        },
      },
      {
        name: 'dialog-delete-purchase',
        url: `${APP_URL}${purchasePath}`,
        open: async (page) => {
          await waitForText(page, 'Purchase detail');
          await clickButton(page, 'Delete purchase');
          await waitForText(page, 'Delete purchase?');
        },
      },
      {
        name: 'dialog-delete-wastage',
        url: `${APP_URL}/wastage`,
        open: async (page) => {
          await waitForText(page, 'Wastage');
          await clickAndSettle(await findVisible(page, '[aria-label="Delete entry"]'));
          await waitForText(page, 'Delete this entry?');
        },
      },
      {
        name: 'sheet-more-menu',
        url: `${APP_URL}/home`,
        // Only below NAV_SIDE_BREAKPOINT (840px) — AppShell swaps the bottom nav + "More" sheet for
        // a side menu listing everything directly from there up, so there's no "More" button to open.
        widths: SHEET_WIDTHS.filter((w) => w < 840),
        open: async (page) => {
          await clickAndSettle(await findVisible(page, '[aria-label="More"]'));
        },
      },
      {
        name: 'sheet-prepare-reminder',
        url: `${APP_URL}/counts`,
        open: async (page) => {
          await waitForText(page, "Today's counts");
          await clickButton(page, `Remind ${ownerName}`);
          await waitForText(page, 'Message about the late stock count');
        },
      },
      // Step 12 — Step 19 moved "Add" inline onto the page itself (the plain `settings-stock`/
      // `settings-sell` route checks above already cover that); only editing is still a sheet.
      {
        name: 'sheet-edit-stock-item',
        url: `${APP_URL}/settings/stock`,
        open: async (page) => {
          await waitForText(page, 'What you buy');
          await (await findVisible(page, '[aria-label="Fresh Paneer"]')).click();
          await waitForText(page, 'Edit stock item');
        },
      },
      {
        name: 'sheet-edit-sell-item',
        url: `${APP_URL}/settings/sell`,
        open: async (page) => {
          await waitForText(page, 'What you sell');
          await (await findVisible(page, '[aria-label="Paneer Tikka"]')).click();
          await waitForText(page, 'Edit dish');
        },
      },
      // Step 13
      {
        name: 'sheet-add-team-member',
        url: `${APP_URL}/team`,
        open: async (page) => {
          await waitForText(page, 'Team');
          await clickButton(page, 'Add team member');
          await waitForText(page, 'Add team member');
        },
      },
      {
        name: 'sheet-reset-pin',
        url: `${APP_URL}${teamMemberPath}`,
        open: async (page) => {
          await waitForText(page, 'Team member');
          await clickButton(page, 'Reset PIN');
          await waitForText(page, 'Reset PIN?');
        },
      },
      {
        name: 'dialog-remove-member',
        url: `${APP_URL}${teamMemberPath}`,
        open: async (page) => {
          await waitForText(page, 'Team member');
          await clickButton(page, 'Remove from team');
          await waitForText(page, 'from the team?');
        },
      },
      // Step 14
      {
        name: 'sheet-record-sales',
        url: `${APP_URL}/sales`,
        open: async (page) => {
          await waitForText(page, 'Sales');
          await clickButton(page, 'Record sales');
          await waitForText(page, 'What did you sell?');
        },
      },
      {
        name: 'dialog-delete-sales',
        url: `${APP_URL}/sales`,
        open: async (page) => {
          await waitForText(page, 'Sales');
          await clickAndSettle(await findVisible(page, '[aria-label="Delete entry"]'));
          await waitForText(page, 'Delete sales entry?');
        },
      },
    ];
    const allOwnerNames = [...ownerRoutes.map((r) => r.name), ...ownerSheets.map((s) => s.name)];
    if (JSON.stringify(allOwnerNames) !== JSON.stringify(SCREEN_MANIFEST.owner)) {
      fail(`SCREEN_MANIFEST.owner is out of sync with ownerRoutes/ownerSheets: ${allOwnerNames}`);
    }

    if (needOwner) {
      for (const sheet of screen ? ownerSheets.filter((s) => s.name === screen) : ownerSheets) {
        for (const width of sheet.widths ?? SHEET_WIDTHS) {
          console.log(`  ${sheet.name.padEnd(26)} ${width}px`);
          await timedCheck(`${sheet.name}@${width}`, () =>
            checkSheetAtWidth(ownerPage, sheet, width, failures),
          );
        }
      }
    }
    await ownerPage.close();

    const helperPage = await browser.newPage();
    const helperSheets = [
      {
        name: 'sheet-profile-helper',
        url: `${APP_URL}/home`,
        open: async (page) => {
          await clickAndSettle(await findVisible(page, '[aria-label="Open profile menu"]'));
        },
      },
      {
        name: 'sheet-record-wastage-helper',
        url: `${APP_URL}/wastage`,
        open: async (page) => {
          await waitForText(page, 'Wastage');
          await clickButton(page, 'Record wastage');
          await waitForText(page, 'What was lost?');
        },
      },
    ];
    const allHelperNames = [...helperRoutes.map((r) => r.name), ...helperSheets.map((s) => s.name)];
    if (JSON.stringify(allHelperNames) !== JSON.stringify(SCREEN_MANIFEST.helper)) {
      fail(`SCREEN_MANIFEST.helper is out of sync with helperRoutes/helperSheets: ${allHelperNames}`);
    }
    if (needHelper) {
      await injectTokens(helperPage, helperTokens);
      for (const route of screen ? helperRoutes.filter((r) => r.name === screen) : helperRoutes) {
        for (const width of WIDTHS) {
          console.log(`  ${route.name.padEnd(14)} ${width}px`);
          await timedCheck(`${route.name}@${width}`, () =>
            checkRouteAtWidth(helperPage, route, width, failures),
          );
        }
      }
      for (const sheet of screen ? helperSheets.filter((s) => s.name === screen) : helperSheets) {
        for (const width of sheet.widths ?? SHEET_WIDTHS) {
          console.log(`  ${sheet.name.padEnd(26)} ${width}px`);
          await timedCheck(`${sheet.name}@${width}`, () =>
            checkSheetAtWidth(helperPage, sheet, width, failures),
          );
        }
      }
    }
    await helperPage.close();

    const headChefPage = await browser.newPage();
    const allHeadChefNames = headChefRoutes.map((r) => r.name);
    if (JSON.stringify(allHeadChefNames) !== JSON.stringify(SCREEN_MANIFEST.headchef)) {
      fail(`SCREEN_MANIFEST.headchef is out of sync with headChefRoutes: ${allHeadChefNames}`);
    }
    if (needHeadChef) {
      await injectTokens(headChefPage, headChefTokens);
      for (const route of screen ? headChefRoutes.filter((r) => r.name === screen) : headChefRoutes) {
        for (const width of WIDTHS) {
          console.log(`  ${route.name.padEnd(14)} ${width}px`);
          await timedCheck(`${route.name}@${width}`, () =>
            checkRouteAtWidth(headChefPage, route, width, failures),
          );
        }
      }
    }
    await headChefPage.close();

    console.log('');
    if (timings.length > 1) {
      console.log('Slowest route/sheet x width checks:');
      for (const [n, s] of [...timings].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
        console.log(`  ${s.toFixed(1)}s  ${n}`);
      }
      console.log('');
    }
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

// ---------- self-test ----------

/** Proves the clipping check can actually fail: injects a deliberately clipped input into a real
 * screen (a fixed-width overflow:hidden wrapper, with the input forced wider than it), confirms
 * `measurePage` reports it, then removes the injected element and confirms the page is clean again.
 * Run with: node scripts/responsive_check.mjs --self-test */
async function selfTest() {
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  const landingServer = await ensureLandingServer(8082);
  let ok = true;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 900 });
    await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle0', timeout: TIMEOUT });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const before = await measurePage(page);
    if (before.clippedControls.length > 0) {
      console.log('SELF-TEST FAIL: /login already has a clipped control before injection — pick a cleaner host screen.');
      ok = false;
    }

    await page.evaluate(() => {
      const wrapper = document.createElement('div');
      wrapper.id = 'self-test-clip-wrapper';
      wrapper.style.cssText = 'width:60px;overflow:hidden;position:relative;';
      const input = document.createElement('input');
      input.id = 'self-test-clip-input';
      input.setAttribute('aria-label', 'Self-test clipped field');
      input.style.cssText = 'width:300px;height:44px;display:block;';
      wrapper.appendChild(input);
      document.body.appendChild(wrapper);
    });

    const during = await measurePage(page);
    const caught = during.clippedControls.some((c) => c.text === 'Self-test clipped field');
    if (!caught) {
      console.log('SELF-TEST FAIL: the injected clipped input was NOT flagged by measurePage().');
      console.log('clippedControls found:', JSON.stringify(during.clippedControls));
      ok = false;
    } else {
      console.log('SELF-TEST: injected a clipped input — measurePage() correctly flagged it.');
    }

    await page.evaluate(() => {
      document.getElementById('self-test-clip-wrapper')?.remove();
    });

    const after = await measurePage(page);
    const stillThere = after.clippedControls.some((c) => c.text === 'Self-test clipped field');
    if (stillThere) {
      console.log('SELF-TEST FAIL: the injected input is still flagged after removal — cleanup failed.');
      ok = false;
    } else {
      console.log('SELF-TEST: removed the injected input — the page is clean again.');
    }

    await page.close();
  } finally {
    await browser.close();
    if (landingServer) landingServer.close();
  }

  if (ok) {
    console.log('\nSELF-TEST PASSED — the clipping check can catch a real clipped control.');
  } else {
    console.log('\nSELF-TEST FAILED — see above.');
    process.exitCode = 1;
  }
}

if (process.argv.includes('--self-test')) {
  selfTest().catch((err) => fail(err.stack ?? String(err)));
} else {
  main().catch((err) => fail(err.stack ?? String(err)));
}
