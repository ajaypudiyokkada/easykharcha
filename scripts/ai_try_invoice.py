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
    python scripts/ai_try_invoice.py bill.jpg --model claude-sonnet-5-5
    python scripts/ai_try_invoice.py bill.jpg --business 12     # also match to that business's items

--business reads that business's items you sell from the dev database (read-only: no row is written)
and prints the match result for each line and the checks. Unresolved lines make ONE real matching call
(its cost is added to the total).
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


def _match_and_check(business_id: int, data: dict) -> dict | None:
    """Read-only: matches the read lines against this business's items and runs the checks. Nothing
    is written to the database (no AiUsage row, no import)."""
    from types import SimpleNamespace

    from businesses.models import Business
    from invoices.import_checks import compute_checks
    from invoices.import_matching import match_lines
    from sales.service import business_today

    business = Business.objects.filter(id=business_id).first()
    if business is None:
        print(f"No business {business_id} in the dev database; skipping matching.", file=sys.stderr)
        return None
    if not data.get("readability", {}).get("ok", True):
        return None
    calls: list = []

    def provider(lines, items):
        result = anthropic_provider.match_bill_lines(lines, items)
        calls.append(result)
        return result

    lines = data["lines"]
    match_lines(SimpleNamespace(id=0, business=business), lines, provider=provider, record=False)
    draft = {**data, "lines": lines}
    checks = compute_checks(draft, business_today(business))
    cost = sum((_cost(r.input_tokens, r.output_tokens) for r in calls), Decimal("0"))
    rows = [
        f"  {ln['line_id']}: {ln['name_as_printed']!r} -> {ln['match']['state']} "
        f"({ln['match']['source']})"
        + (
            f" {ln['match']['sell_item_name']}"
            if ln["match"]["sell_item_name"]
            else (f" suggest {ln['match']['suggestion']['name']}" if ln["match"]["suggestion"] else "")
        )
        for ln in lines
    ]
    printout = (
        f"Matching against business {business_id} ({len(calls)} AI call, +${cost:.4f}):\n"
        + "\n".join(rows)
        + "\nChecks: "
        + (", ".join(f"{c['code']}({c['severity']})" for c in checks) or "none")
    )
    return {"cost": cost, "printout": printout, "summary": {"lines": lines, "checks": checks}}


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("bill_file", type=Path, help="Path to one bill image or PDF")
    parser.add_argument("--model", help="Model for the bill read (default AI_MODEL_INVOICE)")
    parser.add_argument(
        "--business", type=int, help="Business id whose items you sell to match against (read-only)"
    )
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

    if args.model:
        settings.AI_MODEL_INVOICE = args.model
    print(f"Reading {args.bill_file.name}: {sent}, model {settings.AI_MODEL_INVOICE}...")
    result = anthropic_provider.extract_invoice(files)
    cost = _cost(result.input_tokens, result.output_tokens)
    extra = _match_and_check(args.business, result.data) if args.business else None
    if extra:
        cost += extra["cost"]

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
                "matching": extra["summary"] if extra else None,
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
    if extra:
        print(extra["printout"])
    print(f"Full result written to {out_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
