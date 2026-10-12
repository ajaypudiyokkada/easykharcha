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
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startLandingServer } from './lib/landing_server.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BACKEND_DIR = join(ROOT, 'backend');
const MOBILE_DIR = join(ROOT, 'mobile');
const LANDING_PORT = 8082;

const VENV_PYTHON = join(ROOT, '.venv', 'Scripts', 'python.exe');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// The first non-internal IPv4 address — good enough for "which Wi-Fi am I on" on a dev machine with
// one active network adapter. Never hardcoded: read fresh every run, so it's correct on any network.
function findLanAddress() {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
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

  const lan = findLanAddress();

  console.log('Starting EasyKharcha:');
  console.log('  Landing:  http://127.0.0.1:8082/   <- Open this one: http://localhost:8082');
  console.log('  App:      http://localhost:8081/');
  console.log('  Backend:  http://127.0.0.1:8000/api/v1/');
  if (lan) {
    console.log('');
    console.log('  On your phone (same Wi-Fi):');
    console.log(`  Landing:  http://${lan}:8082/`);
    console.log(`  App:      http://${lan}:8081/`);
  } else {
    console.log('');
    console.log('  (no LAN network address found — phone testing needs this machine on Wi-Fi/Ethernet)');
  }
  console.log('');

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  const backend = spawn(VENV_PYTHON, ['manage.py', 'runserver', '0.0.0.0:8000'], {
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

  const landing = startLandingServer(LANDING_PORT);

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
