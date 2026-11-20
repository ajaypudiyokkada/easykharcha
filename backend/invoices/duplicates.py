"""Duplicate detection for an imported bill (Step S4c). Deterministic, against THIS business's
non-voided invoices (created or imported). Run when the draft is read and again at confirm, since an
invoice may have been made in between. Each finding carries the earlier invoice's id, number and date
for the app's "View earlier invoice" link, and says whether the owner must tick "add anyway"."""

import re
from datetime import date
from decimal import Decimal, InvalidOperation

from .models import ImportStatus, Invoice, InvoiceImport, InvoiceStatus

TOTAL_TOLERANCE = Decimal("0.01")
_NOT_ALNUM = re.compile(r"[^a-z0-9]")


def normalize_bill_number(text: str | None) -> str:
    """'KOL/26-27/004521' and 'kol 26 27 004521' compare equal: lowercase letters and digits only."""
    return _NOT_ALNUM.sub("", str(text or "").lower())


def _dec(value) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


def draft_total(draft: dict) -> Decimal | None:
    """The bill's printed total. Only the printed grand total counts for duplicate matching."""
    return _dec(draft.get("grand_total"))


def _ref(invoice: Invoice) -> dict:
    return {
        "invoice_id": invoice.id,
        "number": invoice.number,
        "date": (invoice.bill_date or invoice.sale_date).isoformat(),
    }


def _finding(code: str, invoice: Invoice, *, needs_add_anyway: bool) -> dict:
    return {
        "code": code,
        "severity": "warn",
        "needs_add_anyway": needs_add_anyway,
        "data": _ref(invoice),
    }


def find_duplicates(
    business,
    draft: dict,
    bill_date: date | None,
    *,
    bill_number: str | None,
    exclude_import_id: int,
) -> list[dict]:
    """`bill_number` is the number the owner is confirming (the draft's, or one they filled in);
    `bill_date` the date compared. Voided invoices never count."""
    findings: list[dict] = []
    live = Invoice.objects.filter(business=business).exclude(status=InvoiceStatus.VOID)
    total = draft_total(draft)

    def same_total(invoice: Invoice) -> bool:
        return total is not None and abs(invoice.total - total) <= TOTAL_TOLERANCE

    def same_date(invoice: Invoice) -> bool:
        return bill_date is not None and (invoice.bill_date or invoice.sale_date) == bill_date

    number = normalize_bill_number(bill_number)
    if number:
        for invoice in live.exclude(bill_number_printed=""):
            if (
                normalize_bill_number(invoice.bill_number_printed) == number
                and same_date(invoice)
                and same_total(invoice)
            ):
                findings.append(_finding("DUPLICATE_BILL", invoice, needs_add_anyway=True))
                break
    else:
        # No bill number to go on: the same date and the same total is only a possibility.
        for invoice in live.order_by("-id"):
            if same_date(invoice) and same_total(invoice):
                findings.append(_finding("POSSIBLE_DUPLICATE", invoice, needs_add_anyway=True))
                break

    # The very same photo was already confirmed into an invoice (an unconfirmed earlier import is only
    # a warning on the draft itself, never something to tick).
    same_id = draft.get("same_photo_import_id")
    if same_id:
        earlier = (
            InvoiceImport.objects.filter(
                id=same_id,
                business=business,
                status=ImportStatus.CONFIRMED,
                invoice__isnull=False,
            )
            .exclude(id=exclude_import_id)
            .select_related("invoice")
            .first()
        )
        if earlier is not None and earlier.invoice.status != InvoiceStatus.VOID:
            findings.append(_finding("SAME_PHOTO", earlier.invoice, needs_add_anyway=True))
    return findings


def draft_bill_date(draft: dict) -> date | None:
    raw = draft.get("bill_date")
    return date.fromisoformat(raw) if raw else None
