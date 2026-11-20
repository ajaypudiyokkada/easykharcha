#!/usr/bin/env python
"""Try the REAL bill-reading call against one local bill (image or PDF), using the real
ANTHROPIC_API_KEY from backend/.env: never AI_FAKE, whatever is set there. For judging prompt quality
on real bills by hand; not part of any automated check. The key is never printed or logged.

An image goes through the same pipeline an upload does (shared checks, EXIF stripped, resized to
1600px, JPEG) before it is read, so what is tested is what the app would really send. A PDF is sent
as is.

The structured result and the cost are written to a JSON file under _private/ (git-ignored; nothing
there is ever committed) and a short summary is printed.

Usage:
    python scripts/ai_try_invoice.py path/to/bill.jpg
    python scripts/ai_try_invoice.py path/to/bill.pdf
"""

import argparse
import json
import os
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402

from ai.invoice_prompts import INVOICE_PROMPT_VERSION  # noqa: E402
from ai.provider import anthropic_provider  # noqa: E402
from invoices.images import process_upload  # noqa: E402

_PDF_MAX_BYTES = 10 * 1024 * 1024


class _Upload:
    """The few things process_upload needs from an uploaded file."""

    def __init__(self, data: bytes):
        self._data = data
        self.size = len(data)

    def read(self) -> bytes:
        return self._data


def _cost(input_tokens: int, output_tokens: int) -> Decimal:
    return (
        Decimal(input_tokens) / Decimal(1_000_000) * settings.AI_PRICE_IN_PER_MTOK
        + Decimal(output_tokens) / Decimal(1_000_000) * settings.AI_PRICE_OUT_PER_MTOK
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("bill_file", type=Path, help="Path to one bill image or PDF")
    args = parser.parse_args()

    if not settings.ANTHROPIC_API_KEY:
        print("No ANTHROPIC_API_KEY set in backend/.env; refusing to run.", file=sys.stderr)
        sys.exit(1)
    if not args.bill_file.is_file():
        print(f"No such file: {args.bill_file}", file=sys.stderr)
        sys.exit(1)

    original = args.bill_file.read_bytes()
    if original[:5] == b"%PDF-":
        if len(original) > _PDF_MAX_BYTES:
            print("That PDF is over the 10 MB limit the app enforces.", file=sys.stderr)
            sys.exit(1)
        files = [{"media_type": "application/pdf", "data": original}]
        sent = "PDF as is"
    else:
        jpeg, _sha, _size = process_upload(_Upload(original))
        files = [{"media_type": "image/jpeg", "data": jpeg}]
        sent = f"JPEG {len(jpeg) // 1024} KB (processed like an upload)"

    print(f"Reading {args.bill_file.name}: {sent}, model {settings.AI_MODEL_INVOICE}...")
    result = anthropic_provider.extract_invoice(files)
    cost = _cost(result.input_tokens, result.output_tokens)

    out_dir = ROOT / "_private"
    out_dir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = out_dir / f"invoice_read_{args.bill_file.stem}_{stamp}.json"
    out_path.write_text(
        json.dumps(
            {
                "source_file": args.bill_file.name,
                "prompt_version": INVOICE_PROMPT_VERSION,
                "model": result.model,
                "used_fallback_model": result.used_fallback,
                "input_tokens": result.input_tokens,
                "output_tokens": result.output_tokens,
                "est_cost_usd": f"{cost:.4f}",
                "result": result.data,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    data = result.data
    readability = data.get("readability", {})
    print(f"Model used: {result.model}{' (fallback)' if result.used_fallback else ''}")
    print(f"Tokens: {result.input_tokens} in, {result.output_tokens} out. Cost: ${cost:.4f}")
    if not readability.get("ok", True):
        print(f"NOT READABLE: {readability.get('reason') or 'no reason given'}")
    else:
        print(
            f"Bill {data.get('bill_number')} dated {data.get('bill_date')} "
            f"(printed {data.get('bill_date_printed')!r}), {len(data.get('lines', []))} line(s), "
            f"grand total {data.get('grand_total')}, reprint: {data.get('is_reprint')}"
        )
    print(f"Full result written to {out_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
