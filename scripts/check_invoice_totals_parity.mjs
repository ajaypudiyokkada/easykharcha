#!/usr/bin/env node
/**
 * Step S3c: proves mobile/src/invoices/money.ts computes the same line amounts, tax and totals as
 * backend/invoices/service.py for a fixed set of cases (including half-paise rounding). Run with:
 *   node scripts/check_invoice_totals_parity.mjs
 * Loads the real money.ts (transpiled in-memory) and the real backend helper (via
 * scripts/_dump_backend_invoice_totals.py), same approach as check_units_parity.mjs.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(REPO_ROOT, "mobile", "package.json"));

function loadMoney() {
  const ts = require("typescript");
  const sourcePath = path.join(
    REPO_ROOT,
    "mobile",
    "src",
    "invoices",
    "money.ts",
  );
  const { outputText } = ts.transpileModule(readFileSync(sourcePath, "utf-8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
  });
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname) { ${outputText}\n})`,
  );
  wrapper(
    module.exports,
    require,
    module,
    sourcePath,
    path.dirname(sourcePath),
  );
  return module.exports;
}

const python = path.join(REPO_ROOT, ".venv", "Scripts", "python.exe");
const result = spawnSync(python, ["scripts/_dump_backend_invoice_totals.py"], {
  cwd: REPO_ROOT,
  encoding: "utf-8",
});
if (result.status !== 0) {
  console.error(`_dump_backend_invoice_totals.py failed:\n${result.stderr}`);
  process.exit(1);
}
const cases = JSON.parse(result.stdout);
const money = loadMoney();

const failures = [];
for (const c of cases) {
  const amounts = c.lines.map(([q, r]) =>
    money.lineAmountPaise(money.parseScaled(q, 3), money.parseScaled(r, 2)),
  );
  const totals = money.invoiceTotals(
    amounts,
    c.enabled,
    money.parseScaled(c.rate, 2),
  );
  const got = {
    amounts: amounts.map(money.paiseToDecimal),
    subtotal: money.paiseToDecimal(totals.subtotal),
    tax: money.paiseToDecimal(totals.tax),
    total: money.paiseToDecimal(totals.total),
  };
  const want = {
    amounts: c.amounts,
    subtotal: c.subtotal,
    tax: c.tax,
    total: c.total,
  };
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures.push(
      `${JSON.stringify(c.lines)} tax=${c.enabled ? c.rate : "off"}: client ${JSON.stringify(got)} vs backend ${JSON.stringify(want)}`,
    );
  }
}
if (failures.length) {
  console.error(
    "check_invoice_totals_parity FAILED:\n  " + failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  `check_invoice_totals_parity: client totals match the backend for ${cases.length} cases.`,
);
