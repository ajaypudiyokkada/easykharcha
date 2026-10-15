#!/usr/bin/env node
/**
 * Step 16a: one-off export of the EasyKharcha wordmark crops used across the app and the landing
 * page, from the two source files in docs/images/ (EasyKharchaLogoPlain.png — plain wordmark;
 * EasyKharchaLogoText.png — wordmark + tagline, startup screen only). Each source is trimmed to its
 * real content first (both have generous transparent padding baked in) so a "28px tall" slot isn't
 * mostly empty space, then resized to each size this step's design calls for, 1x and 2x.
 *
 * Not wired into any npm script — these sources don't change on every build, so (like the sources
 * themselves) the outputs are committed directly. Re-run by hand if docs/images/EasyKharchaLogo*.png
 * ever changes:  node scripts/generate_brand_wordmarks.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const PLAIN = 'docs/images/EasyKharchaLogoPlain.png';
const TEXT = 'docs/images/EasyKharchaLogoText.png';

const APP_DIR = 'mobile/assets/brand';
const LANDING_DIR = 'landing/assets';

mkdirSync(APP_DIR, { recursive: true });
mkdirSync(LANDING_DIR, { recursive: true });

async function trimmedSource(path) {
  const { data, info } = await sharp(path).trim({ threshold: 10 }).toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

async function exportAt(source, height, outPaths) {
  const width = Math.round((source.width / source.height) * height);
  const png = await sharp(source.buffer)
    .resize(width, height)
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  // Writing the already-encoded buffer directly, rather than round-tripping it through sharp()
  // again per path — a second .toFile() re-decodes and re-encodes with sharp's own PNG defaults,
  // silently dropping the palette/compressionLevel options set above.
  for (const path of outPaths) {
    writeFileSync(path, png);
    console.log(`Wrote ${path} (${width}x${height}, ${(png.length / 1024).toFixed(1)} KB)`);
  }
}

async function main() {
  const plain = await trimmedSource(PLAIN);
  const text = await trimmedSource(TEXT);

  // "Bars" — landing top bar + footer, the setup wizard header, the profile sheet header, and the
  // desktop side-menu brand block. 24-32px tall in a bar; 28 is the midpoint.
  await exportAt(plain, 28, [`${APP_DIR}/wordmark-bar.png`, `${LANDING_DIR}/wordmark-bar.png`]);
  await exportAt(plain, 56, [`${APP_DIR}/wordmark-bar@2x.png`, `${LANDING_DIR}/wordmark-bar@2x.png`]);

  // "Auth screens" — sign-up, login, and "You're all set" (a standalone screen moment, not a slim
  // bar). 40-56px tall; 48 is the midpoint.
  await exportAt(plain, 48, [`${APP_DIR}/wordmark-auth.png`]);
  await exportAt(plain, 96, [`${APP_DIR}/wordmark-auth@2x.png`]);

  // Startup loading screen only — the tagline version, sized for a brief splash-like moment rather
  // than a bar or a form heading.
  await exportAt(text, 64, [`${APP_DIR}/startup-logo.png`]);
  await exportAt(text, 128, [`${APP_DIR}/startup-logo@2x.png`]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
