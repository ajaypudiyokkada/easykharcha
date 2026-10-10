# Petpooja — Orders Master Report (Excel)

Profile of FOMO's real export, produced per `PETPOOJA_IMPORT_PROMPT.md` Step 1 before any parser was
written.

**Verdict: this report cannot drive sales import.** It is order-level and carries no item names and no
item quantities. See [Granularity](#3-granularity--the-blocking-finding). The item-wise report is the
format we will implement instead; this document stays as the record of why.

| | |
|---|---|
| File profiled | `Orders_Master_Report_2026_10_08_19_23_31.xlsx` (FOMO, Coorg) |
| Kept at | `backend/imports/_private/petpooja_orders_master_sept2026.xlsx` — **gitignored** |
| Range | 1–30 September 2026 |
| Rows | 520 sheet rows = 3 title + 2 blank + 1 header + 510 orders + 4 summary |
| Sheets | `Sheet1` only |

Customer columns are masked throughout this write-up and must never appear in a committed fixture.

## 1. Layout

```
r1  Date:             | 2026-09-01 to 2026-09-30
r2  Name:             | Orders: Master Report
r3  Restaurant Name:  | FOMO, Coorg
r4  (blank)
r5  (blank)
r6  HEADER ROW        | Invoice No. | Date | Biller | ...
r7..r516                510 order rows
r517..r520              Total | Min. | Max. | Avg.   <- summary block, not orders
```

The header is on **row 6**, not row 1, and the last four rows are a summary block keyed by the
`Invoice No.` column holding the literal strings `Total`, `Min.`, `Max.`, `Avg.`. Any parser must find
the header by signature and drop those four rows, or the month's totals get counted as four extra
orders. No merged cells.

## 2. Columns

43 columns. Grouped by what they are:

**Identity and routing** — `Invoice No.`, `Date`, `Biller`, `KOT No.`, `Order Type`, `Sub Order Type`,
`Status`, `Area`, `Group Name`, `Brand Name`, `GSTIN`, `Assign To`, `Persons`, `Order Cancel Reason`

**Payment** — `Payment Type`, `Payment Description`

**Customer — PII, never to be stored or committed** — `Phone`, `Name`, `Address`, `Locality`

**Money** — `My Amount (₹)` (gross), `Discount (₹)`, `Net Sales (₹)(M.A - D)`, `Delivery Charge`,
`Container Charge`, `Service Charge`, `Additional Charge`, `Deduction Charge`, `Total Tax (₹)`,
`Round Off`, `Waived off`, `Total (₹)`, `Tip (₹)`, `Non Taxable`, `Online Tax Calculated`,
`GST Paid by Merchant`, `GST Paid by Ecommerce`, `Amount (SGST)`, `SGST`, `Amount (CGST)`, `CGST`,
`Amount (Unknown Tax)`, `Unknown Tax`

## 3. Granularity — the blocking finding

**One row per order. No item name column. No item quantity column. No packed item text cell.**

The closest thing to item detail is `KOT No.`, which holds kitchen-ticket numbers (e.g. `2, 3, 4`) —
ticket identifiers, not dishes. There is no second sheet.

Consequences:

- Per-dish sales cannot be derived, so this report cannot feed `Sale` rows, and therefore cannot feed
  the variance engine — which exists to compare plates sold against stock consumed.
- `PETPOOJA_IMPORT_PROMPT.md` Step 4 (derive FOMO's menu from the export) is impossible from this file:
  there are no item names to derive a menu from.
- Per the prompt's own instruction, we stop here rather than invent a parsing hack. AP is exporting
  Petpooja's **item-wise** report; that becomes the approved Petpooja format.

## 4. Dates and the business-day cutoff

`Date` is a **string**, not an Excel datetime: `2026-09-30 23:38:03`. A parser must `strptime` it, not
rely on openpyxl's type coercion.

- Span: `2026-09-01 14:07:08` → `2026-09-30 23:38:03`
- **Orders before 04:00: zero.** Earliest in the month is 14:07, latest 23:38.

So `business_day_cutoff_hour` is still worth building — a late-night kitchen elsewhere will need it —
but it would reclassify **no rows at all** for FOMO. Confirmed with AP: default 4, and it is inert here.

## 5. Status and order type

| Column | Distinct values |
|---|---|
| `Status` | `Success` × 510 |
| `Order Type` | `Dine In` × 510 |
| `Sub Order Type` | `Dine In` × 510 |
| `Payment Type` | `UPI` × 395, `Cash` × 90, `Part Payment` × 25 |

This month contains **no cancelled, void, complimentary or aggregator orders**, so the export tells us
nothing about how Petpooja represents them. The status-filtering and `channel` rules must be built from
the item-wise report's own values and verified against a month that actually contains them — not
assumed from this one.

## 6. Money and reconciliation

The summary block gives the file's own month totals:

| | Gross `My Amount` | `Discount` | `Net Sales (M.A - D)` |
|---|---|---|---|
| **Total** | 862,363.00 | 2,090.00 | **860,273.00** |
| Min. | 20.00 | 0.00 | 20.00 |
| Max. | 21,318.00 | 879.00 | 21,318.00 |
| Avg. | 1,690.91 | 4.10 | 1,686.81 |

`Net Sales = My Amount − Discount` holds exactly at the month level (862,363 − 2,090 = 860,273), and
Avg. × 510 = 862,364 confirms 510 is the order count.

**₹860,273 over 510 orders is the reconciliation target** for whatever item-wise export replaces this
file: the sum of item-level net sales should tie to it, and a material gap means the two reports use
different bases or filters.

Charges are all zero this month (delivery, container, service, additional, deduction), consistent with
a dine-in-only month.

## 7. Revenue basis (decided)

`Sale.revenue` = **item amount net of discount, excluding tax and all charges.**

Cost % must be measured against food sales, not tax collected or service charge. This also matches the
`Net Sales (₹)(M.A - D)` column here, so the order-level and item-wise reports reconcile against each
other at ₹860,273.

Excluded: GST (SGST/CGST), service charge, delivery, container, additional/deduction charges, tip,
round-off.

## 8. Privacy

**222 of 510 rows carry a customer phone, name and address.** This is why:

- `import_data/`, `backend/imports/_private/` and `*.xlsx` are gitignored (`.gitignore`).
- The importer parses in memory and persists **only** the `SalesImport` summary and the resulting
  `Sale` rows — never the uploaded file, never a customer column.
- Test fixtures are synthetic and anonymised. No real export is ever committed.

Verified: no spreadsheet has ever entered this repository's git history.

## 9. Data quality

- No blank or duplicate invoice numbers among the 510 orders.
- No negative amounts.
- All rows fall inside September 2026 — no stragglers.
- The only non-order rows are the four summary rows (§1).

## 10. What a parser for this format would need

Recorded for completeness; **not implemented**, because the format cannot produce item quantities.

1. Find the header row by signature (`Invoice No.` + `Date` + `Net Sales`), not by index.
2. Drop rows whose `Invoice No.` is `Total`/`Min.`/`Max.`/`Avg.`.
3. Parse `Date` as a string with `%Y-%m-%d %H:%M:%S`.
4. Apply `business_day_cutoff_hour` to get the business date.
5. Reconcile the parsed net-sales sum against the `Total` summary row and surface any difference.
6. Drop every customer column before anything is returned or logged.
