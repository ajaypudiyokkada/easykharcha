"""Confirming an imported bill (Step S4c): the one call that turns a reviewed draft into an invoice and
sales. AI suggested, the owner decided; nothing posts without this call.

The numbers come from the SERVER's draft, never from the request: the body only carries decisions
(which item, not an item, or skip, per line), the sale date, an optional bill number, and optional
payment. Everything happens in ONE transaction: a failure creates nothing and uses no invoice number."""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.db import transaction
from django.http import Http404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException

from audit.log import log_action
from sales.models import SaleSource
from sales.service import business_today, record_sales

from .duplicates import draft_bill_date, find_duplicates
from .exceptions import InvoiceValidationError
from .models import (
    AliasKind,
    ImportStatus,
    Invoice,
    InvoiceImport,
    InvoiceLine,
    InvoiceLineKind,
    InvoiceSource,
    SellItemAlias,
)
from .normalize import normalize_name
from .payment import log_paid, paid_fields, parse_payment
from .service import _money, _next_sequence_no, format_number

CENT = Decimal("0.01")
ZERO = Decimal("0")
DECISIONS = {
    "item": InvoiceLineKind.ITEM,
    "not_item": InvoiceLineKind.NOT_ITEM,
    "skip": InvoiceLineKind.SKIPPED,
}
MAX_QTY = Decimal("9999999.999")
MAX_AMOUNT = Decimal("9999999999.99")


class ImportNotReady(APIException):
    status_code = 409
    default_detail = "This bill isn't ready to add. Read it again or choose another photo."
    default_code = "IMPORT_NOT_READY"


class ImportAlreadyConfirmed(APIException):
    status_code = 409
    default_detail = "This bill was already added."
    default_code = "IMPORT_ALREADY_CONFIRMED"


def _dec(value) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        return None
    return number if number.is_finite() else None


def _round(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def discount_shares(
    amounts: list[Decimal | None], discount_total: Decimal, denominator: Decimal
) -> list[Decimal]:
    """Each line's share of the bill discount: discount x amount / denominator, rounded to paise. A
    line with no amount has no share. (The caller puts the rounding remainder on one recorded line.)"""
    shares = []
    for amount in amounts:
        if amount is None or denominator <= 0 or discount_total <= 0:
            shares.append(ZERO)
        else:
            shares.append(_round(discount_total * amount / denominator))
    return shares


def _row_error(row_errors: list, row: int, line: dict, field: str, message: str) -> None:
    row_errors.append({"row": row, "line_id": line["line_id"], "field": field, "message": message})


class _ConfirmHeader(serializers.Serializer):
    idempotency_key = serializers.CharField(max_length=64)
    sale_date = serializers.DateField()
    bill_number = serializers.CharField(max_length=40, required=False, allow_blank=True)
    accept_partial = serializers.BooleanField(required=False, default=False)
    add_anyway = serializers.BooleanField(required=False, default=False)


def _flatten(errors: dict) -> dict:
    return {
        field: str(messages[0] if isinstance(messages, list) else messages)
        for field, messages in errors.items()
    }


def confirm_import(*, business, user, import_id: int, data) -> tuple[Invoice, bool]:
    """Returns (invoice, created). `created` is False for a replay of the same idempotency key."""
    field_errors: dict = {}
    header_serializer = _ConfirmHeader(data=data)
    if not header_serializer.is_valid():
        field_errors.update(_flatten(header_serializer.errors))
    header = header_serializer.validated_data if not field_errors else {}
    key = header.get("idempotency_key") or str(data.get("idempotency_key") or "").strip()[:64]

    with transaction.atomic():
        # Locks this import: a second simultaneous confirm waits here, then sees it confirmed.
        imp = (
            InvoiceImport.objects.select_for_update()
            .select_related("image", "invoice")
            .filter(id=import_id, business=business)
            .first()
        )
        if imp is None:
            raise Http404()
        if imp.status == ImportStatus.CONFIRMED:
            if imp.invoice is not None and key and imp.invoice.idempotency_key == key:
                return imp.invoice, False
            raise ImportAlreadyConfirmed()
        if imp.status != ImportStatus.READY or not imp.draft:
            raise ImportNotReady()

        draft = imp.draft
        draft_lines = draft.get("lines", [])
        row_errors: list[dict] = []

        # --- sale date ---
        sale_date: date | None = header.get("sale_date")
        if "sale_date" not in field_errors:
            if sale_date is None:
                field_errors["sale_date"] = "Choose the sale date."
            elif sale_date > business_today(business):
                field_errors["sale_date"] = "Choose today or an earlier date."
        if not key:
            field_errors["idempotency_key"] = "Something went wrong. Please try again."
        elif Invoice.objects.filter(business=business, idempotency_key=key).exists():
            field_errors["idempotency_key"] = "This request was already used. Please try again."

        # --- one decision per draft line ---
        raw_lines = data.get("lines")
        decisions: dict[str, dict] = {}
        if not isinstance(raw_lines, list) or not raw_lines:
            field_errors["lines"] = "Choose what to do with each line of the bill."
            raw_lines = []
        known_ids = {line["line_id"] for line in draft_lines}
        for raw in raw_lines:
            line_id = raw.get("line_id") if isinstance(raw, dict) else None
            if line_id not in known_ids:
                field_errors["lines"] = "One of the lines isn't part of this bill."
            elif line_id in decisions:
                field_errors["lines"] = "A line was sent twice."
            else:
                decisions[line_id] = raw

        items_by_id = {item.id: item for item in business.sell_items.filter(active=True)}
        plan = []  # (draft line, decision dict, kind, sell_item, qty, amount)
        for row, line in enumerate(draft_lines, start=1):
            raw = decisions.get(line["line_id"])

            if raw is None:
                if "lines" not in field_errors:
                    _row_error(
                        row_errors, row, line, "decision", "Choose what to do with this line."
                    )
                continue
            decision = str(raw.get("decision") or "")
            if decision not in DECISIONS:
                _row_error(row_errors, row, line, "decision", "Choose what to do with this line.")
                continue
            kind = DECISIONS[decision]
            qty, amount = _dec(line.get("qty")), _dec(line.get("amount"))
            sell_item = None
            if kind == InvoiceLineKind.ITEM:
                if (
                    qty is None
                    or amount is None
                    or qty <= 0
                    or qty > MAX_QTY
                    or amount < 0
                    or amount > MAX_AMOUNT
                ):
                    _row_error(
                        row_errors,
                        row,
                        line,
                        "decision",
                        "The quantity or amount on this line couldn't be read. "
                        "Skip it or mark it as not an item.",
                    )
                    continue
                try:
                    sell_item = items_by_id.get(int(raw.get("sell_item_id")))
                except (TypeError, ValueError):
                    sell_item = None
                if sell_item is None:
                    _row_error(
                        row_errors, row, line, "sell_item_id", "Choose an item from this business."
                    )
                    continue
            plan.append((line, raw, kind, sell_item, qty, amount))

        kinds = [p[2] for p in plan]
        if not row_errors and "lines" not in field_errors:
            if InvoiceLineKind.ITEM not in kinds:
                field_errors["lines"] = "Record at least one item from this bill."
            if InvoiceLineKind.SKIPPED in kinds and not header.get("accept_partial"):
                field_errors["accept_partial"] = (
                    "Some lines will not be recorded. Confirm that this is what you want."
                )

        # --- payment (same rules as Create invoice) ---
        payment, payment_errors = parse_payment(business, data.get("payment"))
        field_errors.update(payment_errors)

        # --- bill number the owner confirms ---
        bill_number = str(header.get("bill_number") or "").strip() or (
            draft.get("bill_number") or ""
        )

        # --- duplicates (again now, in case an invoice was made since the draft was read) ---
        duplicates = []
        if sale_date is not None and not field_errors and not row_errors:
            duplicates = find_duplicates(
                business,
                draft,
                draft_bill_date(draft) or sale_date,
                bill_number=bill_number,
                exclude_import_id=imp.id,
            )
            if duplicates and not header.get("add_anyway"):
                field_errors["add_anyway"] = (
                    "This bill looks like it was already added. Tick that you checked it to add it anyway."
                )

        if field_errors or row_errors:
            raise InvoiceValidationError(field_errors, row_errors)

        # --- the money, all from the draft ---
        all_amounts = [_dec(line.get("amount")) for line in draft_lines]
        sum_of_lines = sum((a for a in all_amounts if a is not None), start=ZERO)
        items_total = _dec(draft.get("items_total"))
        denominator = items_total if items_total is not None else sum_of_lines
        discount_total = sum(
            (abs(_dec(c.get("amount")) or ZERO) for c in draft.get("discounts", [])), start=ZERO
        )
        shares = dict(
            zip(
                (line["line_id"] for line in draft_lines),
                discount_shares(all_amounts, discount_total, denominator),
                strict=True,
            )
        )
        item_plan = [p for p in plan if p[2] == InvoiceLineKind.ITEM]
        # The rounding remainder lands on the largest recorded line, so a fully recorded bill adds up
        # to items total minus discount exactly.
        remainder = discount_total - sum(shares.values(), start=ZERO)
        if item_plan and denominator > 0 and discount_total > 0:
            largest = max(item_plan, key=lambda p: p[5])
            shares[largest[0]["line_id"]] += remainder
        recorded = {}
        for line, _raw, _kind, _item, _qty, amount in item_plan:
            value = amount - shares[line["line_id"]]
            if value < 0:
                raise InvoiceValidationError(
                    {"lines": "The discount on this bill is larger than its items. Check the bill."}
                )
            recorded[line["line_id"]] = value

        tax_lines = [
            {"label": c.get("label", ""), "amount": c.get("amount")} for c in draft.get("taxes", [])
        ]
        tax_amount = sum(
            (_dec(c.get("amount")) or ZERO for c in draft.get("taxes", [])), start=ZERO
        )
        round_off = _dec(draft.get("round_off"))
        subtotal = items_total if items_total is not None else sum_of_lines
        grand = _dec(draft.get("grand_total"))
        total = (
            grand
            if grand is not None
            else subtotal - discount_total + tax_amount + (round_off or ZERO)
        )

        # --- post ---
        sequence_no = _next_sequence_no(business)
        paid = paid_fields(business, user, payment) if payment else {}
        invoice = Invoice.objects.create(
            business=business,
            number=format_number(business.id, sequence_no),
            sequence_no=sequence_no,
            source=InvoiceSource.IMPORTED,
            sale_date=sale_date,
            subtotal=_money(subtotal),
            tax_rate=ZERO,
            tax_amount=_money(tax_amount),
            total=_money(total),
            idempotency_key=key,
            created_by=user,
            bill_date=draft_bill_date(draft),
            bill_number_printed=bill_number[:40],
            bill_date_printed=(draft.get("bill_date_printed") or "")[:40],
            printed_items_total=_money(items_total) if items_total is not None else None,
            discount_total=_money(discount_total),
            tax_lines=tax_lines,
            round_off=_money(round_off) if round_off is not None else None,
            partly_recorded=InvoiceLineKind.SKIPPED in kinds,
            **paid,
        )
        sales = record_sales(
            business=business,
            user=user,
            business_date=sale_date,
            lines=[
                {
                    "sell_item": item,
                    "quantity": qty.quantize(Decimal("0.001")),
                    "amount": _money(recorded[line["line_id"]]),
                }
                for line, _raw, _kind, item, qty, _amount in item_plan
            ],
            source=SaleSource.INVOICE,
        )
        sale_by_line = {p[0]["line_id"]: sale for p, sale in zip(item_plan, sales, strict=True)}
        InvoiceLine.objects.bulk_create(
            [
                InvoiceLine(
                    invoice=invoice,
                    kind=kind,
                    sell_item=item,
                    name=(item.name if item else line["name_as_printed"])[:120],
                    name_as_printed=line["name_as_printed"][:120],
                    quantity=qty.quantize(Decimal("0.001")) if qty is not None else None,
                    rate=_money(_dec(line.get("unit_rate")))
                    if _dec(line.get("unit_rate")) is not None
                    else None,
                    amount=_money(amount) if amount is not None else None,
                    recorded_amount=_money(recorded[line["line_id"]])
                    if line["line_id"] in recorded
                    else None,
                    sale=sale_by_line.get(line["line_id"]),
                    position=position,
                )
                for position, (line, _raw, kind, item, qty, amount) in enumerate(plan)
            ]
        )

        # --- "Remember this match" (part of the same transaction) ---
        for line, raw, kind, item, _qty, _amount in plan:
            alias = normalize_name(line["name_as_printed"])
            if not raw.get("remember") or not alias or kind == InvoiceLineKind.SKIPPED:
                continue
            SellItemAlias.objects.update_or_create(
                business=business,
                normalized_alias=alias[:120],
                defaults={
                    "kind": AliasKind.ITEM if kind == InvoiceLineKind.ITEM else AliasKind.NOT_ITEM,
                    "sell_item": item,
                    "created_by": user,
                },
            )

        # --- close the import; its photo is now part of the invoice's record ---
        imp.status = ImportStatus.CONFIRMED
        imp.invoice = invoice
        imp.confirmed_at = timezone.now()
        imp.save(update_fields=["status", "invoice", "confirmed_at"])
        if imp.image is not None:
            imp.image.attached = True
            imp.image.save(update_fields=["attached"])

    log_action(
        user=user,
        action="invoice.import_confirm",
        business=business,
        invoice_id=invoice.id,
        number=invoice.number,
        import_id=imp.id,
        recorded=len(item_plan),
        not_item=kinds.count(InvoiceLineKind.NOT_ITEM),
        skipped=kinds.count(InvoiceLineKind.SKIPPED),
        total=str(invoice.total),
        sale_ids=[sale.id for sale in sales],
    )
    if payment:
        log_paid(user=user, invoice=invoice)
    return invoice, True
