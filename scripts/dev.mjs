#!/usr/bin/env node
/**
 * One command for the whole local stack: the Django backend, the Expo web dev server, and a static
 * server for the landing page — so opening the app no longer means remembering three separate
 * terminals and ports.
 *
 * Run with:  npm run dev
 *
 * Windows-first (this project's stack is Windows + PowerShell — see CLAUDE.md), but the three
 * children are plain cross-platform commands underneath.
 */

import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BACKEND_DIR = join(ROOT, 'backend');
const MOBILE_DIR = join(ROOT, 'mobile');
const LANDING_DIR = join(ROOT, 'landing');
const LANDING_PORT = 8082;

const VENV_PYTHON = join(ROOT, '.venv', 'Scripts', 'python.exe');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// A single static file (landing/index.html today) — no SPA fallback needed, there's nothing to
// route client-side.
function serveLanding() {
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
  server.listen(LANDING_PORT, '127.0.0.1');
  return server;
}

function prefixedPipe(child, label) {
  for (const [stream, out] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) out.write(`[${label}] ${line}\n`);
    });
  }
}

async function main() {
  if (!existsSync(VENV_PYTHON)) {
    fail(`no venv at ${VENV_PYTHON} — see README for the setup commands.`);
  }

  console.log('Starting EasyKharcha:');
  console.log('  Backend:  http://127.0.0.1:8000/api/v1/');
  console.log('  App:      http://localhost:8081/');
  console.log('  Landing:  http://127.0.0.1:8082/');
  console.log('');

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  const backend = spawn(VENV_PYTHON, ['manage.py', 'runserver', '127.0.0.1:8000'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DJANGO_SETTINGS_MODULE: 'config.settings' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  prefixedPipe(backend, 'backend');

  // npm on Windows is npm.cmd, a batch script — spawn() can only run that through a shell (plain
  // spawn of a .cmd without one fails with EINVAL, not a missing-file error).
  const mobile = spawn(npmCmd, ['run', 'start'], {
    cwd: MOBILE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  prefixedPipe(mobile, 'app');

  const landing = serveLanding();

  const children = [backend, mobile];
  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nStopping EasyKharcha…');
    for (const child of children) {
      // mobile was spawned through a shell wrapper (above) — killing just that process leaves the
      // real Expo/Metro process it launched still running and holding :8081. `taskkill /T` kills the
      // whole tree instead; plain `child.kill()` is enough for backend, spawned directly.
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill();
      }
    }
    landing.close();
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  for (const child of children) {
    child.on('exit', (code) => {
      if (!shuttingDown) {
        console.error(`FAIL: a child process exited unexpectedly (code ${code}).`);
        shutdown();
      }
    });
  }
}

main();
