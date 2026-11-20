# Step 0 (S3-audit) — Create Invoice / Import Invoice: read-only audit

Docs only. No app code changed. Findings are from the code on branch `step-62s2-sale-hub` (HEAD 1489187).

## A. Sales

- **Model:** `backend/sales/models.py` `Sale` — one row per sell item per date: `business`, `sell_item` (PROTECT),
  `business_date` (DateField), `quantity` (3dp), `amount` (2dp), `source` (only `manual` exists, `SaleSource`),
  `recorded_by`, `created_at`, soft-delete (`is_deleted/deleted_by/deleted_at`). **There is no header and no
  line-item table**: a "sale" is one flat row per item. A POST of N lines makes N `Sale` rows with nothing
  tying them together except the audit-log row's `sale_ids`.
- **Create path:** `sales/views.py` `SaleListCreateView.post` → `_validate_lines` (active sell items of this
  business only; `amount` defaults to qty × `selling_price`) → `Sale.objects.bulk_create` inside
  `transaction.atomic`. There is no separate service function; the logic is in the view.
  `MAX_LINES = 30`. Future dates rejected (`FutureSaleDate`).
- **Business date:** yes, separate from created time. `business_date` is the business-local *calendar* date
  (`_business_today`, uses `Business.timezone`, NOT shifted by `day_starts_hour`). `created_at` is the audit time.
- **Readers:** `counts/gap.py` (`lines_with_gap`: `Sale` filtered `is_deleted=False`, `business_date` inside
  the count window, summed `quantity` × recipe qty per portion; `sales_missing` if any date in the window has no
  sale row at all), `stock/low_stock.py` (same filter), `reports/service.py` (`_sales_vs_cost`, recipe
  coverage, uses `amount`). **So anything that creates `Sale` rows feeds expected-usage/gap maths automatically.
  "Only confirmed sales feed gap maths" is already true as long as nothing writes a `Sale` before confirm.**
- **Audit:** `audit.log.log_action(action="sale.create", business_date, line_count, total_amount, sale_ids)`;
  delete logs `sale.delete`. `AuditLog.metadata` is a JSON column, never purged.
- **Idempotency: none** for sales (no key, no unique constraint). A double-tap or retried POST creates
  duplicate rows. The invoice work must add its own.
- **Permissions** (`businesses/permissions.py`): `sales.view`, `sales.create`, `sales.delete`. Manager has
  view+create; Owner has all (computed). `sales.create` is the right gate. **Delete is Owner-only (`sales.delete`)** —
  decide who can void an invoice (see Q5).

## B. Sell items

- `stock/models.py` `SellItem`: `business`, `name` (unique per business, case-insensitive), `selling_price`,
  `portion_label`, `recipe_status` (none/unconfirmed/confirmed), `group`, `active`, `ek_key`. Ingredients in
  `SellItemIngredient`; batch recipes via `SellItemBase`.
- **No alias / remembered-match table exists.** Existing matching is name-only and stateless:
  `ai/matching.py` `normalise()`, `match_stock_item()` (exact, then `difflib` cutoff 0.82), `existing_dish_names()`.
  It matches *stock items*, not sell items, and nothing is remembered. Menu scan only stamps `existing` on a dish by
  exact normalised name. `ai/knowledge/` "aliases" are static JSON for ingredients, not per-business.
  → A per-business alias table is new work.

## C. Business ID ("RestID")

- `Business` (`businesses/models.py`) has only the auto `id` (BigAutoField) — no short code, no slug.
  `<RestID>` can only be `Business.id` today (e.g. `EK_17_INV-000001`).
- **Simplest option:** use `Business.id` as is. It is stable, unique, needs no migration, no backfill.
  Downsides: reveals approximate customer count, and is not "pretty". Alternative (not recommended now): add
  `Business.code` (e.g. 5-char base32, unique, generated at `creation.create_business`) with a backfill migration.
  The number is **stored on the invoice at creation**, so a later switch to `code` would not rewrite old invoices.

## D. AI layer

- **Image + PDF to the model: yes, already.** `ai/prompts.py` `menu_messages` builds `image` blocks (jpeg/png/webp)
  and a `document` block (application/pdf), base64. Provider functions in `ai/provider/anthropic_provider.py`
  (`extract_menu` etc.) all go through `_get_raw` + `base.run_with_fallback` (forced tool call, one retry, fallback
  model, `AiCallResult` with tokens). `fake.py` mirrors it for `AI_FAKE`. A new `extract_invoice(files)` + prompt +
  tool + pydantic schema is the same shape — no provider-interface change needed.
- **MenuScan intake** (`ai/views.py` `MenuScanCreateView`): client resizes first (`mobile/src/forms/
  menuFileValidation.ts` `resizeImageForUpload`: canvas, ~1600px, JPEG ~0.8, steps down to ≤4 MB); server re-validates
  with Pillow (`_validate_image`, never trusts Content-Type; ≤4 MB), PDF by `%PDF-` header + `pypdf` page count
  (≤10 MB, ≤10 pages), 1–6 images or one PDF. Files go to `settings.AI_TEMP_ROOT` (`ai/files.py`
  `save_temp_files`), **deleted right after the job** — never durable.
- **Job pattern reusable: yes.** `MenuScan` row (queued/reading/done/failed, `result` JSON, token fields) →
  inline when `AI_FAKE`, else `run_ai_jobs` polls (`ai/management/commands/run_ai_jobs.py`), with per-job try/except,
  10-min stuck recovery, requeue on restart. A bill read would be a new `InvoiceScan`-style row (or reuse `MenuScan`
  with a `kind`) plus one more branch in the poll loop. One bill = 1 image or 1 PDF (spec) → much smaller than a menu.
- **Caps / usage:** `ai/limits.py`: per-business daily counters in Django cache (`check_daily_scan_limit`,
  `AI_DAILY_SCANS_PER_BUSINESS`=5, `check_daily_pages_limit`=20) keyed by date; whole-deployment `monthly_cost_cap_exceeded`
  (`AI_MONTHLY_CAP_USD`=20) from `AiUsage`; `record_usage` writes one `AiUsage` row per call (`kind`, model, tokens,
  `est_cost_usd`). Needs a new `AiUsageKind.INVOICE_READ`. **Caveat:** the daily scan bucket is shared with menu scan +
  EK setup (5/day); invoice import will exhaust it fast for a busy shop → needs its own, higher bucket (Q4).
  Prod cache is file-based (`CACHE_BACKEND`), shared by gunicorn workers in one container but **not** the `worker`
  container, so a cap checked in the web request (as menu scan does) is fine.

## E. File storage

- `MEDIA_ROOT` = env `MEDIA_ROOT` (default `backend/media`), `MEDIA_URL=/media/`. Today only business logos use it
  (`Business.logo`, `upload_to="business_logos/"`).
- **Prod:** `docker-compose.prod.yml` volume `media_files` → backend `/app/media` and **Caddy `/srv/media:ro`,
  and `deploy/Caddyfile` has `handle_path /media/* { root * /srv/media; file_server }` — i.e. everything under
  MEDIA_ROOT is publicly served, unauthenticated.** Bill images **must not** go under MEDIA_ROOT. Use a new private
  root (e.g. `INVOICE_IMAGE_ROOT`, new volume `invoice_files` mounted in `backend` (write/read) and `worker` (read +
  purge), **not** in Caddy), and serve through an authenticated Django view (`sales.create` + same business) with
  `FileResponse`.
- `ai_tmp_files` is shared backend↔worker (so the worker can read uploads). The same pattern works for the new volume.
- **Backup:** `deploy/backup.sh` only `pg_dump`s the DB. **Neither `media_files` nor any image volume is backed up.**
  That is acceptable for a 60-day audit-trail image (the DB row survives; the photo is best-effort), but say so in
  the owner-facing wording, or add a tarball step later.
- **Disk:** droplet is 1 vCPU / 2 GB RAM; disk size not stated in the repo (`deploy/README.md`). Estimate:
  ~150–400 KB per compressed JPEG at 1600px/q0.8 (hard cap 4 MB). 20 bills/day × 60 days ≈ 1,200 images ≈ 0.2–0.5 GB
  per busy business. Fine for tens of businesses, risky at hundreds on a 25–50 GB droplet. Mitigations: store
  server-recompressed ~1200px JPEG q0.7 (~100–200 KB), cap images per business, log total bytes in the purge job.
  PDFs: store only the first page rendered? Simplest: don't store imported PDFs at all, or store as-is up to 2 MB
  (open question).
- **Daily purge:** best as a **management command** `purge_invoice_images` (idempotent, deletes expired files + clears the
  DB file reference, logs count/bytes), called from the **existing `worker`'s loop once per day** (a
  `last_purge_date` check beside `sweep_old_temp_files()` in `run_ai_jobs.py`; the worker is already always-on, no cron
  exists in compose). Also add the command to `deploy/README.md` as an optional host cron. Don't rely on `AI_FAKE`
  inline mode: dev just runs the command by hand.
- **Retention setting location:** **Django settings via env var** `INVOICE_IMAGE_RETENTION_DAYS` (default 60) — there is
  **no database system-settings table**; `BusinessSettings` is per-business only and `settings.py` is where every other
  system-level knob lives (`AI_DAILY_SCANS_PER_BUSINESS`, `AI_MONTHLY_CAP_USD`). Changing it needs a restart/redeploy.
  **Recommendation (agreed):** purge always evaluates `uploaded_at < now - current N`, so a changed value applies to
  images already stored; shortening deletes sooner, lengthening only helps images not yet purged.

## F. Mobile / PWA

- **Hub:** `mobile/app/record-sale.tsx` (Step S2). Options `manual | scan | report | invoice`, all but `manual` are
  "Coming soon" sheets. Copy in `strings.ts` `saleHub`. Icon `invoice` already in the registry. Design:
  `docs/design/easykharcha_record_sale_hub.html`.
- **Manual flow:** `mobile/src/screens/RecordSalesSheet.tsx` — date, 1+ lines (item, qty, amount, default qty × price),
  `GET sell-items/`, `POST sales/` (`{business_date, lines[]}`); reached from `sales.tsx` and the hub.
- **Libraries:** `expo-image-picker ~16.0.6` is installed (not used by menu scan). Menu scan uses a **raw web
  `<input type=file>`** (`forms/filePicker.ts` `pickFiles`, `accept`, `capture="environment"`; **web only** — returns `[]` on
  native) and canvas resize (`menuFileValidation.ts`). No `expo-document-picker`, no `expo-image-manipulator`, no
  `expo-print`/`expo-sharing`. Since the app is web-first, reuse `pickFiles` + `resizeImageForUpload` and the existing PDF
  limits; no new dependency needed for Import.
- **Print / WhatsApp:** no print or share code exists; `counts/remind` returns a `wa.me` link server-side (pattern to
  copy). Print = `window.print()` on a print-styled bill view (web) — no library needed.
- **PWA limits:** `capture="environment"` is a hint: honoured on Android Chrome and iOS Safari, ignored on desktop
  (opens a file chooser). It works inside an installed PWA on both, but iOS standalone PWAs reload/lose in-memory state when
  the camera app opens, so draft state must survive reload (the app already does this for counts and menu scan:
  `countDraftStorage`, `menuScanDraft` — copy that pattern). No camera preview/live scanning without `getUserMedia`
  (not needed). The service worker must not cache the bill upload/image endpoints (check `scripts/pwa_check.mjs`).
  Camera photos can be 8–15 MB raw; the canvas resize step handles it but can be slow on cheap phones.

## G. Tax / settings

- **No tax/GST setting exists anywhere** (no `gst`/`tax` in models, serializers, settings, mobile). `BusinessSettings`
  holds only alert/deadline numbers. `Business` has no GSTIN/address line/phone fields. For a printed bill the owner
  also needs business address + phone (+ optional GSTIN as a label only): none exist (`Business` has city/pincode/state,
  tagline, logo).
  → New fields needed: tax on/off, tax label ("GST"), rate %, inclusive/exclusive, bill header (address, phone).

---

# Proposal (no code)

## 1. Data model

Principle: **`Sale` stays the one thing gap maths reads.** An invoice is a *document* that owns `Sale` rows; deleting/voiding
it soft-deletes its `Sale` rows. Nothing existing changes shape except one nullable FK on `Sale`.

- **`Invoice`** (new app `invoices/`): `business` FK; `number` (CharField, e.g. `EK_17_INV-000001`) + `seq` (PositiveInteger);
  `source` (`created` | `imported`); `status` (`draft` | `confirmed` | `void`; imports are `draft` while under review, a
  created bill is confirmed in one step); `bill_date` (the business date → copied to each `Sale.business_date`);
  `bill_number_printed` (imported only, text as printed); `printed_subtotal`, `printed_tax`, `printed_total` (imported, as
  read, nullable); `subtotal`, `tax_amount`, `total` (EK-computed, from confirmed lines); `tax_label/rate/inclusive` snapshot;
  `payment_mode` (optional, Q-later); `image_hash` (sha256, imported); `created_by`, `created_at`, `confirmed_at`, `voided_by/at/reason`;
  `idempotency_key` (client UUID). Unique: `(business, seq)`, `(business, number)`, `(business, idempotency_key)`.
- **`InvoiceLine`**: `invoice` FK; `sell_item` FK (PROTECT, **null while an import line is unmatched**, required to confirm);
  `description` (text as shown / as printed); `quantity`, `unit_price`, `line_total` (as saved), `printed_qty/price/total`
  (imported); `sale` OneToOne → `Sale` (set at confirm); `position`.
- **`Sale`**: add nullable `invoice_line` / `invoice` FK and `SaleSource` values `invoice_created`, `invoice_imported`. Manual sales untouched.
  (`Sale.amount` = line total after discount, before tax, so reports/sales-vs-cost stay consistent. Tax is **not** in `Sale.amount`.)
- **`SellItemAlias`** (the remembered match): `business` FK, `sell_item` FK (CASCADE), `alias_normalised` (via `ai.matching.normalise`),
  `alias_text` (as seen), `created_from_invoice` FK nullable, `use_count`, `last_used_at`; unique `(business, alias_normalised)`.
  Written only when the owner confirms a match; matching order on import: alias exact → sell-item exact → fuzzy suggestion (unconfirmed).
- **`InvoiceSequence`**: `business` OneToOne, `last_seq` PositiveInteger. (See 2.)
- **`InvoiceImage`**: `invoice` OneToOne (imports only), `path` (relative, private root), `sha256`, `bytes`, `media_type`,
  `uploaded_at` (**the expiry clock**), `purged_at` (null until the file is deleted; row kept). The read job itself can use an
  `InvoiceScan`/`MenuScan`-style job row holding status + `result` JSON + tokens, linked to the invoice draft.
- **Business additions** (small `BusinessSettings`-style row or fields): `tax_enabled`, `tax_label`, `tax_rate_pct`,
  `tax_inclusive`, `bill_address`, `bill_phone`, optional `gstin_text`.

## 2. Gap-free, race-safe invoice numbers

Allocate the number **inside the same `transaction.atomic()` that saves the invoice and its `Sale` rows**:
`InvoiceSequence.objects.select_for_update().get_or_create(business=…)` (create the row at `create_business`/first use),
`seq = last_seq + 1`, save, then create the `Invoice` with `seq` and the formatted number (`f"EK_{business.id}_INV-{seq:06d}"`).
If anything later in the transaction fails, the whole thing rolls back, including the counter, so **no gaps**; the row lock
serialises concurrent saves for one business, so **no duplicates**. DB unique constraints on `(business, seq)` and
`(business, number)` are the backstop. Caveats: SQLite (dev) has no row locks but serialises writers, so it is correct there
too; use Postgres in prod (already is). Never allocate at draft/import-upload time — only at confirm. Voided invoices keep their
number (void, never delete or renumber). The idempotency key makes a retried confirm return the same invoice instead of burning a number.

## 3. Duplicate detection data

- On `Invoice` (imported): `bill_number_printed`, `bill_date`, `printed_total`, `image_hash`. Index `(business, image_hash)` and
  `(business, bill_date, printed_total)`.
- Check at upload (hash) and again at confirm (number+date+total). Outcome is a **warning the owner can override** ("This looks like
  a bill you recorded on 12 Nov — record again?"), never a hard block; hash match on a `void` invoice does not warn.
- `image_hash` must survive the image purge (it lives on `Invoice`, not only on `InvoiceImage`), so duplicates are still caught
  after 60 days. Hash is of the original uploaded bytes after client resize (resized output isn't byte-stable across devices, so
  number+date+total is the real safety net).
- Also needed: `Invoice.idempotency_key` for double-tap protection on Create (see A).

## 4. Build order (each ≈45 min, one step = one thing)

1. **S3a** Backend: `invoices` app + models + `InvoiceSequence` + number allocation + `Sale.invoice_line` FK + migration; admin read-only.
2. **S3b** Backend: Create Invoice API (`POST invoices/` → invoice + lines + `Sale` rows, atomic, idempotent, audit `invoice.create`; `GET` list/detail; void) + smoke area `invoices`.
3. **S3c** Business tax/bill-header settings (backend fields + Settings screen), tax maths in create.
4. **S3d** Mobile: Create Invoice screen (item picker, qty, price, discount-free, totals, confirm), hub option wired.
5. **S3e** Mobile: invoice detail — print view (`window.print`), WhatsApp click-to-send text, void (Owner).
6. **S3f** Backend: private image store + authenticated image view + `purge_invoice_images` + worker daily hook + `INVOICE_IMAGE_RETENTION_DAYS` + new volume in prod compose.
7. **S3g** Backend: bill-reading job (`extract_invoice` provider fn + prompt/tool/schema + fake + `AiUsageKind` + own daily cap + draft invoice with suggested matches).
8. **S3h** Backend: `SellItemAlias` + matching order + duplicate detection warnings.
9. **S3i** Mobile: Import — pick/capture/resize/upload, analyzing screen (copy menu-scan polling/draft).
10. **S3j** Mobile: review screen (match each line, unmatched must be resolved or skipped, totals vs printed, duplicate warning, Confirm → sales recorded).
11. **S3k** Docs/hub copy, `flow` scenario for create + import, `pwa-check` for no-cache of bill endpoints, privacy notes (`docs/PRIVACY_NOTES.md`).

Create Invoice (S3a–e) can ship before Import (S3f–j).

## 5. Questions for AP (recommended default first)

1. **RestID:** use `Business.id` as is (`EK_17_INV-…`), or add a short public business code first? *Default: use `Business.id`; add a code later if wanted (old numbers keep their value).*
2. **Imported unmatched lines / lines owner skips:** may the owner confirm an import with some lines left out? Left-out lines would not count as sales and so understate expected usage. *Default: yes, but the review shows "N lines not recorded" and the owner must tick it; unmatched lines can be matched, created as a new "item you sell" (price from the bill), or skipped.*
3. **Tax maths on Create:** tax added on top of item prices, or already inside them? And discount per bill? *Default: one per-business toggle "prices include tax" (default inclusive), single rate, no discounts in v1; `Sale.amount` = line total excluding tax.*
4. **AI allowance for imports:** the 5 scans/day bucket is shared with menu scan/EK setup and a busy shop will hit it. *Default: separate `AI_DAILY_INVOICE_READS_PER_BUSINESS` = 30, still under the shared monthly cost cap.*
5. **Who can void an invoice and how:** only Owner holds `sales.delete` today. *Default: Owner-only void (soft: invoice `void`, its `Sale` rows soft-deleted, number kept, reason required, audited); Manager can create/import only. Also: imported PDFs — store the original (≤2 MB) or no stored copy? Default: store only photos, not PDFs.*

## Risks to remember

- Media under `MEDIA_ROOT` is public in prod (Caddy) — keep bill images off it.
- Bill images are not in backups; DB rows are.
- `Sale` has no idempotency; double-submit creates duplicates until S3b.
- Daily AI caps are cache-based and reset if the cache is cleared; the monthly cap (DB) is the real ceiling.

---

## Decisions (AP, 2026-11-20)

1. **RestID = `Business.id`.** Invoice number `EK_<id>_INV-000001`.
2. **Import may be confirmed with some lines skipped**, with a visible "N not recorded" tick-box. The invoice is marked "partly recorded".
3. **Tax:** one flat rate per business, **added on top of** prices, off by default. No discounts in Create Invoice v1. On Import, read discount/tax/round-off as printed and check they reconcile (with a tolerance; never recompute tax from a %). `Sale` rows store the amount **before tax**.
4. **Separate daily AI cap for invoice reads**, default 30, set by an env setting.
5. **Owner-only void:** soft-deletes the linked sales and keeps the invoice number. Photos are stored (retention `INVOICE_IMAGE_RETENTION_DAYS`, default 60). PDFs are read but **not stored** in v1.
6. **Non-item lines on imported bills** (e.g. "Parcel Large", service charge) get a **"Not an item"** choice, separate from "skip".

---

## Import invoice: design gaps after Step S4a

Step S4a builds only upload + read. These states in `docs/design/easykharcha_import_invoice_complete_prototype.html` need data or an endpoint it does not provide yet:

- **Matching** (Matched / Check this match / Not matched, Pick the item sheet, zero matches, "Remember this match next time"): needs the alias table and a match suggestion per line.
- **Duplicate bill warning** (earlier invoice number and date, "View earlier invoice", "Add anyway" tick): needs imported invoices to store bill number, bill date and printed total, plus a lookup endpoint.
- **Same photo warning** ("View earlier invoice"): the draft only carries `same_photo_before` and `same_photo_import_id`; linking to the earlier *invoice* needs the confirm step to tie an import to its invoice.
- **Totals differ / line amount differs warnings:** the draft carries every printed number; the server-side reconciliation (with tolerance) is not built.
- **Not an item / Skip / Undo, "N lines will not be recorded" tick:** needs the confirm endpoint to accept a per-line decision.
- **Payment block on review** (Unpaid/Paid, mode, proof; prefilled from the printed payment mode): the confirm endpoint must accept `payment`.
- **Saving, Success, Partly recorded:** needs the confirm endpoint, an imported-invoice record with a partly-recorded flag and "N of M items".
- **Recent invoices / detail for imported bills** (From a bill badge, "Partly recorded", "3 of 5 items", Recorded items with matched names, the bill's own totals lines, bill photo, "Photo removed"): `Invoice` has no source "imported", bill number, printed totals, tax/discount lines or link to its import and photo yet.
- **Sale date missing or unreadable:** the draft's `bill_date` can be null; the design has no screen for asking the owner for a date.
- **Bill number missing:** also possible (null); no designed state.
- **Review "kept for a limited time" copy:** the draft does not expose how long; the app can only say "limited time".
- Client-only states (camera not allowed, wrong type / too big messages, photo preview, upload progress, taking longer than usual, old and future date warnings) need no new backend beyond the error codes and `created_at`/`heartbeat` already returned.
