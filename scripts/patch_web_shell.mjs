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

const INDEX_HTML = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'mobile', 'dist', 'index.html');
const THEME_COLOR = '#1F6F63';
const BACKGROUND_COLOR = '#FFF9F2';

async function main() {
  let html = await readFile(INDEX_HTML, 'utf8');

  html = html.replace('<html lang="en">', '<html lang="en-IN">');
  html = html.replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />',
  );

  const extraHead = [
    `<meta name="theme-color" content="${THEME_COLOR}" />`,
    '<link rel="manifest" href="/manifest.json" />',
    '<link rel="icon" href="/icons/icon-192.png" />',
    '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
    `<style>html, body { background-color: ${BACKGROUND_COLOR}; }</style>`,
  ].join('\n    ');
  html = html.replace('</head>', `    ${extraHead}\n  </head>`);

  await writeFile(INDEX_HTML, html);
  console.log('OK — patched dist/index.html with manifest link, theme-color and PWA meta tags.');
}

main().catch((err) => {
  console.error(`FAIL: ${err.stack ?? String(err)}`);
  process.exit(1);
});
