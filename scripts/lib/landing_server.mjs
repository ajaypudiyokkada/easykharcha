/**
 * Serves landing/index.html as plain static files — a single page today, no SPA fallback needed.
 * Shared by scripts/dev.mjs (the all-in-one dev command) and scripts/flow.mjs (which needs a real
 * server at the app's configured EXPO_PUBLIC_LANDING_URL for the "/" -> landing redirect to land
 * somewhere real).
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LANDING_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'landing');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Binds and returns the server — caller is responsible for closing it. Localhost only. */
export function startLandingServer(port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = join(LANDING_DIR, requested);

    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) throw new Error('not a file');
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}

/** Reuses whatever's already listening on `port` (e.g. `npm run dev`) if it responds; otherwise
 * starts a fresh one. Returns the server to close afterwards, or `null` if nothing was started —
 * callers must only close what they themselves started. */
export async function ensureLandingServer(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
    if (response.ok) return null;
  } catch {
    // Nothing answering yet — start our own below.
  }
  return startLandingServer(port);
}
