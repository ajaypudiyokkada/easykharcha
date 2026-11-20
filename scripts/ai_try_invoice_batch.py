#!/usr/bin/env python
"""Read every bill in a folder with the REAL extraction (the same call scripts/ai_try_invoice.py
makes), once per model, and write everything to ONE readable text file under _private/. For judging
bill-reading quality and cost by hand; not part of any automated check, and never AI_FAKE.

The API key is used only through the existing Django settings (backend/.env). It is never read,
printed or logged here. Nothing is written outside _private/.

Run from the repo folder, in PowerShell:
    .venv\\Scripts\\Activate.ps1
    python scripts\\ai_try_invoice_batch.py
or without activating:
    .venv\\Scripts\\python.exe scripts\\ai_try_invoice_batch.py

Options:
    python scripts\\ai_try_invoice_batch.py path\\to\\folder          (default: _private\\bills)
    python scripts\\ai_try_invoice_batch.py --models claude-haiku-5-5 claude-sonnet-5-5
    python scripts\\ai_try_invoice_batch.py --usd-inr 88               (rupee conversion rate)

Output: _private\\bill_read_<timestamp>.txt
"""

import argparse
import sys
import time
from datetime import datetime
from decimal import Decimal
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

# Importing the single-bill script runs Django setup (key via settings only) and gives us its
# upload-like preprocessing and cost formula, so both scripts always read a bill the same way.
import ai_try_invoice as single  # noqa: E402
from django.conf import settings  # noqa: E402

from ai.invoice_prompts import INVOICE_PROMPT_VERSION  # noqa: E402
from ai.provider import anthropic_provider  # noqa: E402
from invoices.images import process_upload  # noqa: E402

ROOT = single.ROOT
PRIVATE = ROOT / "_private"
DEFAULT_FOLDER = PRIVATE / "bills"
DEFAULT_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"]
SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
NEXT_TIME = r".venv\Scripts\python.exe scripts\ai_try_invoice_batch.py"


def _prepare(path: Path) -> tuple[list[dict], str]:
    """The bytes the app would really send for this file."""
    original = path.read_bytes()
    if original[:5] == b"%PDF-":
        return [{"media_type": "application/pdf", "data": original}], "PDF as is"
    jpeg, _sha, _size = process_upload(single._Upload(original))
    return [{"media_type": "image/jpeg", "data": jpeg}], f"JPEG {len(jpeg) // 1024} KB (like an upload)"


def _fmt(value) -> str:
    return "-" if value in (None, "") else str(value)


def _describe(data: dict) -> list[str]:
    readability = data.get("readability", {})
    lines = [f"  readability: {'ok' if readability.get('ok', True) else 'NOT READABLE'}"
             + (f" ({readability.get('reason')})" if readability.get("reason") else "")]
    if not readability.get("ok", True):
        return lines
    lines += [
        f"  bill number: {_fmt(data.get('bill_number'))}",
        f"  date as printed: {_fmt(data.get('bill_date_printed'))}    ISO: {_fmt(data.get('bill_date'))}"
        f"    time: {_fmt(data.get('bill_time'))}",
        f"  reprint/copy stamp: {'yes' if data.get('is_reprint') else 'no'}",
        "  lines (name | qty x rate = amount | confidence):",
    ]
    for line in data.get("lines", []):
        lines.append(
            f"    - {line['name_as_printed']} | {_fmt(line.get('qty'))} x {_fmt(line.get('unit_rate'))}"
            f" = {_fmt(line.get('amount'))} | {_fmt(line.get('confidence'))}"
        )
    if not data.get("lines"):
        lines.append("    (none)")
    lines.append(f"  items total: {_fmt(data.get('items_total'))}")
    for charge in data.get("discounts", []):
        lines.append(f"  discount: {charge['label']} = {_fmt(charge.get('amount'))}")
    for charge in data.get("taxes", []):
        lines.append(f"  tax line: {charge['label']} = {_fmt(charge.get('amount'))}")
    lines += [
        f"  round off: {_fmt(data.get('round_off'))}",
        f"  grand total: {_fmt(data.get('grand_total'))}",
        f"  payment mode printed: {_fmt(data.get('payment_mode'))}",
        f"  confidence: {data.get('confidence') or '-'}",
    ]
    return lines


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("folder", nargs="?", type=Path, default=DEFAULT_FOLDER)
    parser.add_argument("--models", nargs="+", default=DEFAULT_MODELS)
    parser.add_argument("--usd-inr", type=Decimal, default=Decimal("88"),
                        help="Rupees per US dollar for the cost shown in rupees (default 88)")
    args = parser.parse_args()

    if not settings.ANTHROPIC_API_KEY:
        print("No ANTHROPIC_API_KEY set in backend/.env; refusing to run.", file=sys.stderr)
        sys.exit(1)
    folder = args.folder if args.folder.is_absolute() else ROOT / args.folder
    if not folder.is_dir():
        print(f"No such folder: {folder}", file=sys.stderr)
        sys.exit(1)
    files = sorted(p for p in folder.iterdir() if p.suffix.lower() in SUFFIXES)
    if not files:
        print(f"No bills (.jpg .jpeg .png .webp .pdf) in {folder}", file=sys.stderr)
        sys.exit(1)

    PRIVATE.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = PRIVATE / f"bill_read_{stamp}.txt"
    total_usd = Decimal("0")
    reads = failures = 0
    out = [
        f"Bill reading run {stamp}",
        f"Folder: {folder}",
        f"Models: {', '.join(args.models)}   prompt version {INVOICE_PROMPT_VERSION}",
        f"Rupee conversion: {args.usd_inr} per USD (approximate)",
        "=" * 70,
    ]

    for number, path in enumerate(files, start=1):
        print(f"[{number}/{len(files)}] {path.name}")
        try:
            prepared, how = _prepare(path)
        except Exception as exc:  # noqa: BLE001 - one bad file must not stop the batch
            failures += 1
            out += ["", f"FILE: {path.name}", f"  could not be prepared: {type(exc).__name__}", "-" * 70]
            continue
        for model in args.models:
            settings.AI_MODEL_INVOICE = model
            started = time.perf_counter()
            out += ["", f"FILE: {path.name}   MODEL: {model}   sent: {how}"]
            try:
                result = anthropic_provider.extract_invoice(prepared)
            except Exception as exc:  # noqa: BLE001 - recorded, never the message (could echo a request)
                failures += 1
                out += [f"  FAILED after {time.perf_counter() - started:.1f} s: {type(exc).__name__}"
                        f" (status {getattr(exc, 'status_code', None)})", "-" * 70]
                continue
            seconds = time.perf_counter() - started
            cost = single._cost(result.input_tokens, result.output_tokens)
            total_usd += cost
            reads += 1
            out += _describe(result.data)
            out += [
                f"  model used: {result.model}{' (fallback)' if result.used_fallback else ''}",
                f"  tokens: {result.input_tokens} in, {result.output_tokens} out",
                f"  cost: Rs {cost * args.usd_inr:.2f}  (${cost:.4f})    time: {seconds:.1f} s",
                "-" * 70,
            ]

    out += [
        "",
        f"TOTAL: {reads} read(s), {failures} failure(s), cost Rs {total_usd * args.usd_inr:.2f} "
        f"(${total_usd:.4f})",
    ]
    out_path.write_text("\n".join(out) + "\n", encoding="utf-8")

    print(f"\nDone: {len(files)} file(s) x {len(args.models)} model(s), {reads} read(s), "
          f"{failures} failure(s).")
    print(f"Total cost: Rs {total_usd * args.usd_inr:.2f} (${total_usd:.4f})")
    print(f"Written to {out_path.relative_to(ROOT)}")
    print(f"Next time run: {NEXT_TIME}")


if __name__ == "__main__":
    main()
