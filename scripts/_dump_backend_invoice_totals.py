"""Prints, as JSON, what backend/invoices/service.py computes for a fixed set of cases, so
scripts/check_invoice_totals_parity.mjs can compare it with mobile/src/invoices/money.ts.
Uses the real service helpers (no database needed)."""

import json
import os
import sys
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from invoices.service import _money  # noqa: E402

# (line [(quantity, rate)], tax_enabled, tax_rate)
CASES = [
    ([("1", "220.00"), ("1", "400.00"), ("3", "20.00")], True, "5.00"),
    ([("1", "220.00")], False, "5.00"),
    ([("2.5", "33.33")], True, "5.00"),
    ([("3", "0.01")], True, "12.50"),
    ([("1", "0.10"), ("1", "0.10"), ("1", "0.10")], True, "18.00"),
    ([("0.001", "999999.99")], True, "2.50"),
    ([("7", "19.99"), ("1.5", "100.01")], True, "5.00"),
    ([("1", "0.05")], True, "10.00"),
]

out = []
for lines, enabled, rate in CASES:
    amounts = [_money(Decimal(q) * Decimal(r)) for q, r in lines]
    subtotal = sum(amounts, start=Decimal("0"))
    tax = _money(subtotal * (Decimal(rate) if enabled else Decimal("0")) / Decimal("100"))
    out.append(
        {
            "lines": lines,
            "enabled": enabled,
            "rate": rate,
            "amounts": [str(a) for a in amounts],
            "subtotal": str(subtotal),
            "tax": str(tax),
            "total": str(subtotal + tax),
        }
    )
print(json.dumps(out))
