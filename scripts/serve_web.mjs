#!/usr/bin/env node
/**
 * Serves the production web export (mobile/dist, built by `npm run build:web`) as plain static
 * files — no bundler, no live reload — so the service worker and manifest can be exercised the way
 * a real deployed build would behave. The Expo dev server never registers a service worker at all
 * (see registerServiceWorker.ts's `__DEV__` check), so this is the only way to test it locally.
 *
 * Run with:  npm run serve:web
 *
 * Localhost only — binds to 127.0.0.1, never 0.0.0.0.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 8082);
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'mobile', 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

async function resolveFile(urlPath) {
  const safePath = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const candidate = join(ROOT, safePath);
  try {
    const stats = await stat(candidate);
    if (stats.isFile()) return candidate;
  } catch {
    // Falls through to the SPA fallback below.
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // sw.js and manifest.json must come straight from the export root, unmangled — no fallback.
  const direct = await resolveFile(url.pathname);
  const filePath = direct ?? join(ROOT, 'index.html');

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Serving mobile/dist at http://127.0.0.1:${PORT}`);
});
