"""Saving and voiding a customer bill. One transaction does everything for a save: take the
business's sequence row (select_for_update), write the Invoice, its Sale rows (through the same
sales.service.record_sales the manual flow uses) and the lines. If any step fails, the whole thing,
including the sequence bump, rolls back, so no number is burnt."""

from decimal import ROUND_HALF_UP, Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone

from audit.log import log_action
from businesses.models import Business
from sales.models import Sale, SaleSource
from sales.service import MAX_LINES, business_today, record_sales, row_errors_from

from .exceptions import InvoiceValidationError
from .models import Invoice, InvoiceLine, InvoiceSequence, InvoiceStatus
from .payment import log_paid, paid_fields, parse_payment
from .serializers import InvoiceCreateSerializer, InvoiceLineInputSerializer

CENT = Decimal("0.01")
ZERO = Decimal("0")
TOLERANCE = Decimal("0.01")
# v1 has no discounts: refuse them loudly instead of silently ignoring a number the owner typed.
_DISCOUNT_KEYS = ("discount", "discount_amount", "discount_pct")


def format_number(business_id: int, sequence_no: int) -> str:
    return f"EK_{business_id}_INV-{sequence_no:06d}"


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _flatten(errors: dict) -> dict:
    return {
        field: str(messages[0] if isinstance(messages, list) else messages)
        for field, messages in errors.items()
    }


def _clean_lines(business: Business, raw_lines) -> tuple[list[dict], list[dict], dict]:
    """Returns (cleaned lines, row errors, field errors for `lines` itself)."""
    if not isinstance(raw_lines, list) or not raw_lines:
        return [], [], {"lines": "Add at least one item to the bill."}
    if len(raw_lines) > MAX_LINES:
        return [], [], {"lines": f"A bill can have up to {MAX_LINES} items."}
    items = {item.id: item for item in business.sell_items.filter(active=True)}
    row_errors: list[dict] = []
    cleaned = []
    for index, row in enumerate(raw_lines, start=1):
        serializer = InvoiceLineInputSerializer(data=row)
        if not serializer.is_valid():
            row_errors.extend(row_errors_from(index, serializer.errors))
            continue
        data = serializer.validated_data
        item = items.get(data["sell_item"])
        if item is None:
            row_errors.append(
                {
                    "row": index,
                    "field": "sell_item",
                    "message": "Choose an item from this business.",
                }
            )
            continue
        rate = data.get("rate")
        if rate is None:
            rate = item.selling_price
        amount = _money(data["quantity"] * rate)
        sent = data.get("amount")
        if sent is not None and abs(sent - amount) > TOLERANCE:
            row_errors.append(
                {
                    "row": index,
                    "field": "amount",
                    "message": f"Amount should be {amount} (quantity x rate).",
                }
            )
            continue
        cleaned.append(
            {"sell_item": item, "quantity": data["quantity"], "rate": rate, "amount": amount}
        )
    return cleaned, row_errors, {}


def _next_sequence_no(business: Business) -> int:
    InvoiceSequence.objects.get_or_create(business=business)
    row = InvoiceSequence.objects.select_for_update().get(business=business)
    row.last_number += 1
    row.save(update_fields=["last_number"])
    return row.last_number


def create_invoice(*, business: Business, user, data) -> tuple[Invoice, bool]:
    """`data` is the raw request body. Returns (invoice, created); `created` is False when the same
    idempotency key was already used for this business, in which case nothing new is written."""
    field_errors: dict = {}
    header_serializer = InvoiceCreateSerializer(data=data)
    if not header_serializer.is_valid():
        field_errors.update(_flatten(header_serializer.errors))
    header = header_serializer.validated_data if not field_errors else {}

    key = header.get("idempotency_key") or None
    if key:
        existing = Invoice.objects.filter(business=business, idempotency_key=key).first()
        if existing:
            return existing, False

    for name in _DISCOUNT_KEYS:
        if name in data:
            field_errors[name] = "Discounts are not available on bills yet."

    # An optional payment object means "create this invoice as Paid"; anything wrong with it means
    # nothing at all is created.
    payment, payment_errors = parse_payment(business, data.get("payment"))
    field_errors.update(payment_errors)

    sale_date = header.get("sale_date")
    if sale_date and sale_date > business_today(business):
        field_errors["sale_date"] = "Choose today or an earlier date."

    lines, row_errors, line_field_errors = _clean_lines(business, data.get("lines"))
    field_errors.update(line_field_errors)

    settings_row = business.settings
    subtotal = sum((line["amount"] for line in lines), start=ZERO)
    tax_rate = settings_row.invoice_tax_rate if settings_row.invoice_tax_enabled else ZERO
    tax_amount = _money(subtotal * tax_rate / Decimal("100"))
    total = subtotal + tax_amount

    if lines and not row_errors:
        for field, mine in (("subtotal", subtotal), ("tax_amount", tax_amount), ("total", total)):
            sent = header.get(field)
            if sent is not None and abs(sent - mine) > TOLERANCE:
                field_errors[field] = f"{field.replace('_', ' ').capitalize()} should be {mine}."

    if field_errors or row_errors:
        raise InvoiceValidationError(field_errors, row_errors)

    try:
        with transaction.atomic():
            sequence_no = _next_sequence_no(business)
            # Claims the proof inside this transaction: if it was used meanwhile, everything
            # (including the number) rolls back.
            paid = paid_fields(business, user, payment) if payment else {}
            invoice = Invoice.objects.create(
                business=business,
                number=format_number(business.id, sequence_no),
                sequence_no=sequence_no,
                sale_date=sale_date,
                customer_name=header.get("customer_name", ""),
                customer_phone=header.get("customer_phone", ""),
                subtotal=subtotal,
                tax_rate=tax_rate,
                tax_amount=tax_amount,
                total=total,
                idempotency_key=key,
                created_by=user,
                **paid,
            )
            # Sale.amount is the line amount BEFORE tax: tax is never counted as sales.
            sales = record_sales(
                business=business,
                user=user,
                business_date=sale_date,
                lines=lines,
                source=SaleSource.INVOICE,
            )
            InvoiceLine.objects.bulk_create(
                [
                    InvoiceLine(
                        invoice=invoice,
                        sell_item=line["sell_item"],
                        name=line["sell_item"].name,
                        quantity=line["quantity"],
                        rate=line["rate"],
                        amount=line["amount"],
                        recorded_amount=line["amount"],
                        sale=sale,
                        position=position,
                    )
                    for position, (line, sale) in enumerate(zip(lines, sales, strict=True))
                ]
            )
    except IntegrityError:
        # A concurrent save with the same idempotency key won the race; this whole attempt (and its
        # number) rolled back, so hand back the winner.
        winner = (
            Invoice.objects.filter(business=business, idempotency_key=key).first() if key else None
        )
        if winner is None:
            raise
        return winner, False

    # One audit entry per invoice (not per line); sale_ids lists the rows it recorded.
    log_action(
        user=user,
        action="invoice.create",
        business=business,
        invoice_id=invoice.id,
        number=invoice.number,
        sale_date=str(sale_date),
        line_count=len(lines),
        subtotal=str(subtotal),
        tax_amount=str(tax_amount),
        total=str(total),
        sale_ids=[sale.id for sale in sales],
    )
    if payment:
        log_paid(user=user, invoice=invoice)
    return invoice, True


def void_invoice(*, invoice: Invoice, user, reason: str) -> Invoice:
    """Idempotent: an already-void invoice is returned unchanged (nothing re-reversed or re-logged)."""
    with transaction.atomic():
        locked = Invoice.objects.select_for_update().get(id=invoice.id)
        if locked.status == InvoiceStatus.VOID:
            return locked
        now = timezone.now()
        sale_ids = [
            sale_id
            for sale_id in locked.lines.values_list("sale_id", flat=True)
            if sale_id is not None
        ]
        Sale.objects.filter(id__in=sale_ids, is_deleted=False).update(
            is_deleted=True, deleted_by=user, deleted_at=now
        )
        locked.status = InvoiceStatus.VOID
        locked.voided_by = user
        locked.voided_at = now
        locked.void_reason = reason
        locked.save(update_fields=["status", "voided_by", "voided_at", "void_reason"])

    log_action(
        user=user,
        action="invoice.void",
        business=locked.business,
        invoice_id=locked.id,
        number=locked.number,
        reason=reason,
        sale_ids=sale_ids,
    )
    return locked
