#!/usr/bin/env node
/**
 * Step S3d: pins the exact output of mobile/src/invoices/billText.ts (the WhatsApp text and the
 * 32-column receipt) against the prototype's example, and checks the "only when set / only when tax
 * was charged" rules. Run with:  node scripts/check_bill_text.mjs
 * Loads the real billText.ts and money.ts (transpiled in memory), like check_units_parity.mjs.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..", "mobile", "src", "invoices");
const require = createRequire(path.join(SRC, "..", "..", "package.json"));
const ts = require("typescript");

const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name).exports;
  const file = path.join(SRC, `${name}.ts`);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf-8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
  });
  const module = { exports: {} };
  cache.set(name, module);
  const localRequire = (id) =>
    id.startsWith("./") ? load(id.slice(2)) : require(id);
  vm.runInThisContext(
    `(function (exports, require, module) { ${outputText}\n})`,
  )(module.exports, localRequire, module);
  return module.exports;
}

const { buildBillText, buildReceiptLines } = load("billText");

const full = {
  name: "MY BUSINESS",
  address: "12 MG Road, Bengaluru 560001",
  phone: "080 4123 4567",
  gstin: "29ABCDE1234F1Z5",
};
const invoice = {
  number: "EK_12_INV-000041",
  sale_date: "2026-11-20",
  subtotal: "680.00",
  tax_rate: "5.00",
  tax_amount: "34.00",
  total: "714.00",
  payment_status: "paid",
  payment_mode: "upi",
  lines: [
    {
      name: "Chicken Fried Rice",
      quantity: "1.000",
      rate: "220.00",
      amount: "220.00",
    },
    {
      name: "Chilli Prawn",
      quantity: "1.000",
      rate: "400.00",
      amount: "400.00",
    },
    { name: "Water Bottle", quantity: "3.000", rate: "20.00", amount: "60.00" },
  ],
};

const failures = [];
function expect(label, got, want) {
  if (got !== want)
    failures.push(`${label}:\n--- got ---\n${got}\n--- want ---\n${want}`);
}

expect(
  "WhatsApp text with tax (the prototype example)",
  buildBillText(full, invoice),
  [
    "MY BUSINESS",
    "12 MG Road, Bengaluru 560001",
    "080 4123 4567",
    "GSTIN: 29ABCDE1234F1Z5",
    "Invoice: EK_12_INV-000041",
    "Date: 20 Nov 2026",
    "Chicken Fried Rice",
    "1 × ₹220 = ₹220",
    "Chilli Prawn",
    "1 × ₹400 = ₹400",
    "Water Bottle",
    "3 × ₹20 = ₹60",
    "Subtotal: ₹680",
    "Tax 5%: ₹34",
    "Total: ₹714",
    "Payment: Paid by UPI",
    "Thank you.",
  ].join("\n"),
);

const noTax = {
  ...invoice,
  subtotal: "680.00",
  tax_rate: "0.00",
  tax_amount: "0.00",
  total: "680.00",
  payment_status: "unpaid",
  payment_mode: "",
};
const bare = { name: "Shop", address: "", phone: " ", gstin: "" };
expect(
  "no tax rows and no empty header lines when nothing is set / no tax was charged",
  buildBillText(bare, noTax),
  [
    "Shop",
    "Invoice: EK_12_INV-000041",
    "Date: 20 Nov 2026",
    "Chicken Fried Rice",
    "1 × ₹220 = ₹220",
    "Chilli Prawn",
    "1 × ₹400 = ₹400",
    "Water Bottle",
    "3 × ₹20 = ₹60",
    "Total: ₹680",
    "Payment: Unpaid",
    "Thank you.",
  ].join("\n"),
);

const paiseInvoice = {
  ...noTax,
  total: "12.50",
  lines: [{ name: "Tea", quantity: "2.500", rate: "5.00", amount: "12.50" }],
};
expect(
  "paise and fractional quantity",
  buildBillText(bare, paiseInvoice).split("\n")[4],
  "2.5 × ₹5 = ₹12.50",
);

for (const [label, inv] of [
  ["with tax", invoice],
  ["no tax", noTax],
]) {
  const rows = buildReceiptLines(full, inv);
  const tooWide = rows.filter((r) => r.length > 32);
  if (tooWide.length)
    failures.push(
      `receipt (${label}) has rows wider than 32: ${JSON.stringify(tooWide)}`,
    );
  if (
    !rows.some(
      (r) =>
        r.startsWith("TOTAL") &&
        r.endsWith(label === "no tax" ? "₹680" : "₹714"),
    )
  ) {
    failures.push(`receipt (${label}) is missing its TOTAL row`);
  }
  if (rows.some((r) => r.startsWith("Subtotal")) !== (label === "with tax")) {
    failures.push(
      `receipt (${label}): Subtotal row should show only when tax was charged`,
    );
  }
}

for (const [mode, word] of [
  ["cash", "cash"],
  ["card", "card"],
  ["bank_transfer", "bank transfer"],
]) {
  const text = buildBillText(bare, { ...invoice, payment_mode: mode });
  if (!text.includes(`Payment: Paid by ${word}\nThank you.`)) {
    failures.push(`payment line for ${mode} should read "Paid by ${word}" just before "Thank you."`);
  }
}
if (!buildReceiptLines(full, invoice).some((r) => r === "Payment: Paid by UPI")) {
  failures.push("the receipt should carry the payment line");
}

if (/tax invoice/i.test(buildBillText(full, invoice)))
  failures.push('the bill must never say "tax invoice"');

if (failures.length) {
  console.error("check_bill_text FAILED:\n" + failures.join("\n\n"));
  process.exit(1);
}
console.log(
  "check_bill_text: WhatsApp text and receipt layout match the prototype (payment line included).",
);
