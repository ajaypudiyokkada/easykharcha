#!/usr/bin/env node
/**
 * Orchestrates the three verification tiers from CLAUDE.md's "Light checking only" policy:
 *
 *   npm run verify -- --area counts [--area sales ...]
 *     = npm run check + the given smoke area(s) (scripts/smoke.py --area ...)
 *
 *   npm run verify:ui -- --area counts --flow today-card --screen count-stock
 *     = verify + one flow scenario (scripts/flow.mjs --only <name>) + one responsive screen
 *       (scripts/responsive_check.mjs --screen <name>)
 *
 *   npm run verify:full
 *     = check + the full smoke suite + the full flow walk + the full responsive check
 *
 * Runs each part as a child process, in order, stopping at the first failure. Prints how long
 * each part took once everything passes — `npm run verify -- --area counts --area sales` runs
 * `check` once and the union of both areas' smoke checks once, same as `smoke.py` itself.
 */

import { spawnSync } from 'node:child_process';

function parseArgs() {
  const args = process.argv.slice(2);
  const mode = args[0];
  const areas = [];
  let flow = null;
  let screen = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--area') areas.push(args[++i]);
    else if (args[i] === '--flow') flow = args[++i];
    else if (args[i] === '--screen') screen = args[++i];
  }
  return { mode, areas, flow, screen };
}

function run(label, cmd, cmdArgs) {
  console.log(`\n--- ${label}: ${cmd} ${cmdArgs.join(' ')} ---`);
  const t0 = Date.now();
  const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
  const seconds = (Date.now() - t0) / 1000;
  if (result.status !== 0) {
    console.error(`\nFAILED: ${label} (${seconds.toFixed(1)}s)`);
    process.exit(result.status ?? 1);
  }
  return seconds;
}

function usageError(message) {
  console.error(`verify: ${message}`);
  process.exit(1);
}

const { mode, areas, flow, screen } = parseArgs();
const durations = {};

if (mode === 'verify') {
  if (areas.length === 0) {
    usageError('pass at least one --area (e.g. npm run verify -- --area counts)');
  }
  durations.check = run('check', 'npm', ['run', 'check']);
  durations.smoke = run('smoke', 'python', [
    'scripts/smoke.py',
    ...areas.flatMap((a) => ['--area', a]),
  ]);
} else if (mode === 'verify:ui') {
  if (areas.length === 0 || !flow || !screen) {
    usageError(
      'needs --area, --flow and --screen (e.g. npm run verify:ui -- --area counts ' +
        '--flow today-card --screen count-stock)',
    );
  }
  durations.check = run('check', 'npm', ['run', 'check']);
  durations.smoke = run('smoke', 'python', [
    'scripts/smoke.py',
    ...areas.flatMap((a) => ['--area', a]),
  ]);
  durations.flow = run('flow', 'node', ['scripts/flow.mjs', '--only', flow]);
  durations.responsive = run('responsive', 'node', [
    'scripts/responsive_check.mjs',
    '--screen',
    screen,
  ]);
} else if (mode === 'verify:full') {
  durations.check = run('check', 'npm', ['run', 'check']);
  durations.smoke = run('smoke', 'python', ['scripts/smoke.py']);
  durations.flow = run('flow', 'node', ['scripts/flow.mjs']);
  durations.responsive = run('responsive', 'node', ['scripts/responsive_check.mjs']);
} else {
  usageError(`unknown mode ${JSON.stringify(mode)} — this script is run via npm run verify[:ui|:full]`);
}

console.log(`\nAll ${mode} parts passed. Durations:`);
for (const [part, seconds] of Object.entries(durations)) {
  console.log(`  ${part.padEnd(12)} ${seconds.toFixed(1)}s`);
}
