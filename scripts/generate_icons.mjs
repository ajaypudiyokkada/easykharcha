#!/usr/bin/env node
/**
 * Draws the EasyKharcha PWA icons from the same mark already used as the landing page's favicon
 * (landing/index.html's <link rel="icon">) — a plain "E" in white on the brand green, not the FOMO
 * logo. Rendered with Puppeteer against the system Chrome (no new image-processing dependency).
 *
 * Run with:  npm run icons
 */

import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const OUT_DIR = 'mobile/public/icons';
const PRIMARY = '#1F6F63';

// Exactly the path data from landing/index.html's favicon <svg>, so both places draw the same mark.
const MARK_PATH = 'M18 17h30v8H27v7h18v8H27v7h21v8H18z';

function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      'no Chrome or Edge install found in the usual locations — set CHROME_PATH to a Chromium-based browser.',
    );
  }
  return process.env.CHROME_PATH ?? found;
}

function markSvg({ size, rounded }) {
  const rx = rounded ? 16 : 0;
  // viewBox stays fixed at the mark's own 64-unit coordinate space; width/height in pixels is what
  // actually scales the rendered output up to the target icon size.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="${rx}" fill="${PRIMARY}"/>
    <path d="${MARK_PATH}" fill="white"/>
  </svg>`;
}

// Maskable and the apple touch icon are full-bleed squares (no corner rounding) — the OS applies
// its own shape mask on top, so a pre-rounded square would double up or look inconsistent.
const TARGETS = [
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-512.png', size: 512, rounded: true },
  { file: 'maskable-512.png', size: 512, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, rounded: false },
];

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  try {
    const page = await browser.newPage();
    for (const target of TARGETS) {
      await page.setViewport({ width: target.size, height: target.size });
      await page.setContent(
        `<html><body style="margin:0;padding:0">${markSvg(target)}</body></html>`,
      );
      await page.waitForSelector('svg');
      const path = `${OUT_DIR}/${target.file}`;
      await page.screenshot({ path, omitBackground: false });
      console.log(`Wrote ${path} (${target.size}x${target.size})`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
