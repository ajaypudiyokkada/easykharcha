#!/usr/bin/env node
/**
 * expo-router's `+html.tsx` convention only applies when `web.output` is "static" — this app uses
 * "single" (one SPA shell for client-side routing), so `expo export -p web` always writes its own
 * fixed index.html template with no way to hook in from inside the app. This patches the exported
 * shell afterwards instead: the manifest link, PWA meta tags and background colour that must be
 * present before React ever mounts.
 *
 * Run automatically as part of `npm run build:web` (mobile/package.json) — not meant to be run on
 * its own.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'mobile', 'dist');
const INDEX_HTML = join(DIST_DIR, 'index.html');
const SW_JS = join(DIST_DIR, 'sw.js');
const THEME_COLOR = '#1F6F63';
const BACKGROUND_COLOR = '#FFF9F2';
const BUILD_VERSION_PLACEHOLDER = '__EK_BUILD_VERSION__';

// A fresh value on every build — not a hash of the output — so each deploy's sw.js is guaranteed
// byte-different from the last one, which is what makes a browser notice a new version exists at
// all (see mobile/src/pwa/registerServiceWorker.ts).
function buildVersion() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

async function patchServiceWorker(version) {
  let sw = await readFile(SW_JS, 'utf8');
  if (!sw.includes(BUILD_VERSION_PLACEHOLDER)) {
    throw new Error(`dist/sw.js has no "${BUILD_VERSION_PLACEHOLDER}" placeholder to replace.`);
  }
  sw = sw.replaceAll(BUILD_VERSION_PLACEHOLDER, version);
  await writeFile(SW_JS, sw);
  console.log(`OK — stamped dist/sw.js with build version ${version}.`);
}

async function main() {
  const version = buildVersion();
  let html = await readFile(INDEX_HTML, 'utf8');

  html = html.replace('<html lang="en">', '<html lang="en-IN">');
  html = html.replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />',
  );

  const extraHead = [
    `<meta name="theme-color" content="${THEME_COLOR}" />`,
    '<link rel="manifest" href="/manifest.json" />',
    '<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />',
    '<link rel="icon" type="image/png" sizes="48x48" href="/icons/favicon-48.png" />',
    '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
    `<style>html, body { background-color: ${BACKGROUND_COLOR}; }</style>`,
    `<script>window.__EK_BUILD_VERSION__ = ${JSON.stringify(version)};</script>`,
  ].join('\n    ');
  html = html.replace('</head>', `    ${extraHead}\n  </head>`);

  await writeFile(INDEX_HTML, html);
  console.log(`OK — patched dist/index.html with manifest link, theme-color, PWA meta tags and build version ${version}.`);

  await patchServiceWorker(version);
}

main().catch((err) => {
  console.error(`FAIL: ${err.stack ?? String(err)}`);
  process.exit(1);
});
