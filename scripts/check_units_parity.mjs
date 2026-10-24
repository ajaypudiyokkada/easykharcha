#!/usr/bin/env node
/**
 * Step U1b-3a: proves mobile/src/units.ts's tables match backend/stock/units.py's exactly, and
 * that its rounding/display behaviour matches the spec's worked examples. Run with:
 *   node scripts/check_units_parity.mjs
 *
 * Loads the real units.ts (transpiled in-memory via the `typescript` package already used for
 * `tsc`, not re-implemented here) and the real backend table (dumped as JSON by
 * scripts/_dump_backend_units.py) so a drift in either file actually fails this, not a copy of
 * either one pasted into the test.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const require = createRequire(path.join(REPO_ROOT, 'mobile', 'package.json'));

function loadUnitsTs() {
  const ts = require('typescript');
  const sourcePath = path.join(REPO_ROOT, 'mobile', 'src', 'units.ts');
  const source = readFileSync(sourcePath, 'utf-8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  });
  const module = { exports: {} };
  // transpileModule emits a plain CommonJS body; wrap and execute it like Node's own loader would.
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname) { ${outputText}\n})`,
  );
  wrapper(module.exports, require, module, sourcePath, path.dirname(sourcePath));
  return module.exports;
}

function loadBackendTables() {
  const result = spawnSync('python', ['scripts/_dump_backend_units.py'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`_dump_backend_units.py failed:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function main() {
  const failures = [];
  const backend = loadBackendTables();
  const units = loadUnitsTs();

  if (!deepEqual(units.UNIT_FAMILY, backend.UNIT_FAMILY)) {
    failures.push(
      `UNIT_FAMILY mismatch: mobile=${JSON.stringify(units.UNIT_FAMILY)} backend=${JSON.stringify(backend.UNIT_FAMILY)}`,
    );
  }
  if (!deepEqual(units.BASE_UNIT_FOR_FAMILY, backend.BASE_UNIT_FOR_FAMILY)) {
    failures.push(
      `BASE_UNIT_FOR_FAMILY mismatch: mobile=${JSON.stringify(units.BASE_UNIT_FOR_FAMILY)} backend=${JSON.stringify(backend.BASE_UNIT_FOR_FAMILY)}`,
    );
  }
  const mobilePackUnits = [...units.PACK_ENTRY_UNITS].sort();
  if (!deepEqual(mobilePackUnits, backend.PACK_ENTRY_UNITS)) {
    failures.push(
      `PACK_ENTRY_UNITS mismatch: mobile=${JSON.stringify(mobilePackUnits)} backend=${JSON.stringify(backend.PACK_ENTRY_UNITS)}`,
    );
  }
  // entryUnitsFor on a bare item (no pack size) exposes the family factor table directly.
  for (const [family, backendFactors] of Object.entries(backend.FAMILY_ENTRY_FACTORS)) {
    const mobileFactors = units.entryUnitsFor({
      unit: Object.keys(backendFactors)[0],
      unit_family: family,
      pack_size_base_qty: null,
    });
    const normalisedBackend = Object.fromEntries(
      Object.entries(backendFactors).map(([k, v]) => [k, Number(v)]),
    );
    if (!deepEqual(mobileFactors, normalisedBackend)) {
      failures.push(
        `FAMILY_ENTRY_FACTORS[${family}] mismatch: mobile=${JSON.stringify(mobileFactors)} backend=${JSON.stringify(normalisedBackend)}`,
      );
    }
  }
  if (units.QUANTITY_DECIMALS !== backend.QUANTITY_DECIMALS) {
    failures.push(
      `QUANTITY_DECIMALS mismatch: mobile=${units.QUANTITY_DECIMALS} backend=${backend.QUANTITY_DECIMALS}`,
    );
  }
  if (units.PRICE_DECIMALS !== backend.PRICE_DECIMALS) {
    failures.push(
      `PRICE_DECIMALS mismatch: mobile=${units.PRICE_DECIMALS} backend=${backend.PRICE_DECIMALS}`,
    );
  }
  if (!deepEqual(units.MAJOR_UNIT_FOR_FAMILY, backend.MAJOR_UNIT_FOR_FAMILY)) {
    failures.push(
      `MAJOR_UNIT_FOR_FAMILY mismatch: mobile=${JSON.stringify(units.MAJOR_UNIT_FOR_FAMILY)} backend=${JSON.stringify(backend.MAJOR_UNIT_FOR_FAMILY)}`,
    );
  }
  if (String(units.MAJOR_UNIT_FACTOR) !== backend.MAJOR_UNIT_FACTOR) {
    failures.push(
      `MAJOR_UNIT_FACTOR mismatch: mobile=${units.MAJOR_UNIT_FACTOR} backend=${backend.MAJOR_UNIT_FACTOR}`,
    );
  }

  // Rounding/display worked examples from docs/UNIT_REDESIGN.md.
  const roundingCases = [
    { baseQty: 3200, unit: 'g', expect: [3.2, 'kg'] },
    { baseQty: 999, unit: 'g', expect: [999, 'g'] },
    { baseQty: 1000, unit: 'ml', expect: [1, 'L'] },
  ];
  for (const { baseQty, unit, expect } of roundingCases) {
    const got = units.displayQuantity(baseQty, unit);
    if (!deepEqual(got, expect)) {
      failures.push(
        `displayQuantity(${baseQty}, '${unit}') = ${JSON.stringify(got)}, expected ${JSON.stringify(expect)}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error('check_units_parity: FAILED\n');
    for (const f of failures) console.error(`  - ${f}`);
    console.error(`\n${failures.length} failure(s).`);
    process.exit(1);
  }
  console.log(
    `check_units_parity: mobile/src/units.ts matches backend/stock/units.py (${roundingCases.length} rounding cases passed).`,
  );
}

main();
