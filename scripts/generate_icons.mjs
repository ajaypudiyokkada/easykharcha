#!/usr/bin/env node
/**
 * Step 16a: draws the EasyKharcha PWA/favicon icon set from the real brand mark
 * (docs/images/ek_logo_icon.png — the "EK" squircle, not the old placeholder "E"), at every size the
 * manifest, the app's HTML head and the landing page's favicon link need. Uses sharp (libvips) for
 * resizing and PNG compression — Puppeteer's own screenshot encoder doesn't expose a compression
 * level and left icon-512.png well over the 40KB budget.
 *
 * Run with:  npm run icons
 */

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const OUT_DIR = 'mobile/public/icons';
const LANDING_OUT_DIR = 'landing/assets';
const SOURCE = resolve('docs/images/ek_logo_icon.png');

// Full-bleed targets: the source mark is already a self-contained rounded "squircle" card (real
// alpha transparency at its corners, not a drawn rect) — scaled to fill the square as-is, same as
// any other app-icon PNG asset.
const FULL_BLEED_TARGETS = [
  { file: 'favicon-32.png', size: 32 },
  { file: 'favicon-48.png', size: 48 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

// Maskable: Android (and other platforms) crop a maskable icon to their own shape, up to 20% in from
// each edge — the mark has to sit inside that 80% "safe zone" on a solid, fully opaque background
// (not the source's own transparent corners) or it gets clipped.
const MASKABLE_SIZE = 512;
const MASKABLE_SAFE_ZONE = Math.round(MASKABLE_SIZE * 0.8);
const MASKABLE_BACKGROUND = { r: 255, g: 255, b: 255, alpha: 1 };

async function writePng(pipeline, path) {
  await pipeline.png({ compressionLevel: 9, palette: true }).toFile(path);
}

async function main() {
  if (!existsSync(SOURCE)) throw new Error(`source mark not found at ${SOURCE}`);

  // Clean slate — nothing from the old drawn "E" mark (or a stale size) should survive a re-run.
  if (existsSync(OUT_DIR)) {
    for (const name of readdirSync(OUT_DIR)) rmSync(`${OUT_DIR}/${name}`);
  } else {
    mkdirSync(OUT_DIR, { recursive: true });
  }

  for (const target of FULL_BLEED_TARGETS) {
    const path = `${OUT_DIR}/${target.file}`;
    await writePng(sharp(SOURCE).resize(target.size, target.size), path);
    console.log(`Wrote ${path} (${target.size}x${target.size})`);
  }

  // The landing page is served from its own origin/directory — it needs its own favicon copies,
  // not a cross-origin reference into the app's /icons/.
  mkdirSync(LANDING_OUT_DIR, { recursive: true });
  for (const target of FULL_BLEED_TARGETS.filter((t) => t.file.startsWith('favicon-'))) {
    const path = `${LANDING_OUT_DIR}/${target.file}`;
    await writePng(sharp(SOURCE).resize(target.size, target.size), path);
    console.log(`Wrote ${path} (${target.size}x${target.size})`);
  }

  const mark = await sharp(SOURCE)
    .resize(MASKABLE_SAFE_ZONE, MASKABLE_SAFE_ZONE)
    .toBuffer();
  const maskablePath = `${OUT_DIR}/maskable-512.png`;
  await writePng(
    sharp({
      create: {
        width: MASKABLE_SIZE,
        height: MASKABLE_SIZE,
        channels: 4,
        background: MASKABLE_BACKGROUND,
      },
    }).composite([
      { input: mark, left: (MASKABLE_SIZE - MASKABLE_SAFE_ZONE) / 2, top: (MASKABLE_SIZE - MASKABLE_SAFE_ZONE) / 2 },
    ]),
    maskablePath,
  );
  console.log(
    `Wrote ${maskablePath} (${MASKABLE_SIZE}x${MASKABLE_SIZE}, mark at ${MASKABLE_SAFE_ZONE}x${MASKABLE_SAFE_ZONE} on solid #FFFFFF)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
