"""Paying an invoice: Paid/Unpaid is a label on the invoice, nothing more. It never touches sales or
stock maths (those read Sale rows, which payment never writes). Full payment only, no part payments.

A proof photo is mandatory for every mode except cash. It is uploaded first (POST payment-proofs/,
stored unattached) and then claimed here, inside the same transaction that marks the invoice paid, so
a failed save claims nothing."""

from django.db import transaction
from django.utils import timezone

from audit.log import log_action
from businesses.models import Business

from .exceptions import InvoicePaymentConflict, InvoiceValidationError
from .models import (
    Invoice,
    InvoiceStatus,
    PaymentMode,
    PaymentStatus,
    StoredImage,
    StoredImageKind,
)

_BAD_PROOF = "This proof photo can't be used. Please upload it again."


def _proof_queryset(business: Business):
    return StoredImage.objects.filter(
        business=business,
        kind=StoredImageKind.PAYMENT_PROOF,
        attached=False,
        removed_at__isnull=True,
    )


def parse_mode(raw) -> tuple[str | None, dict]:
    """Just the mode, for callers that need to know it before anything else."""
    if not isinstance(raw, dict):
        return None, {"payment_mode": "Choose how the customer paid."}
    mode = str(raw.get("mode") or "").strip()
    if mode not in PaymentMode.values:
        return None, {"payment_mode": "Choose how the customer paid."}
    return mode, {}


def parse_payment(business: Business, raw) -> tuple[dict | None, dict]:
    """Returns ({"mode", "proof_id"}, {}) or (None, field_errors). `raw` None means "no payment"
    and is not an error here (the caller decides what that means)."""
    if raw is None:
        return None, {}
    mode, errors = parse_mode(raw)
    if errors:
        return None, errors
    proof_id = raw.get("proof_id")
    has_proof = proof_id not in (None, "")
    if mode == PaymentMode.CASH:
        if has_proof:
            return None, {"proof_id": "Cash payments do not need a proof photo."}
        return {"mode": mode, "proof_id": None}, {}
    if not has_proof:
        return None, {"proof_id": "Add a photo of the payment proof."}
    try:
        proof_pk = int(proof_id)
    except (TypeError, ValueError):
        return None, {"proof_id": _BAD_PROOF}
    if not _proof_queryset(business).filter(id=proof_pk).exists():
        return None, {"proof_id": _BAD_PROOF}
    return {"mode": mode, "proof_id": proof_pk}, {}


def claim_proof(business: Business, proof_id: int) -> StoredImage:
    """Locks and attaches the proof. Call inside transaction.atomic(); raises (rolling the whole
    save back) if it was used or removed since it was checked."""
    proof = _proof_queryset(business).select_for_update().filter(id=proof_id).first()
    if proof is None:
        raise InvoiceValidationError({"proof_id": _BAD_PROOF})
    proof.attached = True
    proof.save(update_fields=["attached"])
    return proof


def paid_fields(business: Business, user, payment: dict) -> dict:
    """The Invoice field values for a paid invoice (claims the proof when there is one)."""
    proof = claim_proof(business, payment["proof_id"]) if payment["proof_id"] else None
    return {
        "payment_status": PaymentStatus.PAID,
        "payment_mode": payment["mode"],
        "paid_at": timezone.now(),
        "paid_by": user,
        "proof": proof,
    }


def log_paid(*, user, invoice: Invoice) -> None:
    log_action(
        user=user,
        action="invoice.paid",
        business=invoice.business,
        invoice_id=invoice.id,
        number=invoice.number,
        mode=invoice.payment_mode,
        proof_id=invoice.proof_id,
    )


def mark_paid(*, invoice: Invoice, user, raw) -> tuple[Invoice, bool]:
    """Returns (invoice, changed). Already paid the same way: unchanged. Paid a different way: 409.
    A void invoice can't be marked paid."""
    mode, errors = parse_mode(raw)
    if errors:
        raise InvoiceValidationError(errors)
    business = invoice.business
    with transaction.atomic():
        locked = Invoice.objects.select_for_update().get(id=invoice.id)
        if locked.status == InvoiceStatus.VOID:
            raise InvoiceValidationError({"status": "A void invoice can't be marked paid."})
        if locked.payment_status == PaymentStatus.PAID:
            if locked.payment_mode == mode:
                return locked, False
            raise InvoicePaymentConflict()
        payment, errors = parse_payment(business, raw)
        if errors:
            raise InvoiceValidationError(errors)
        for field, value in paid_fields(business, user, payment).items():
            setattr(locked, field, value)
        locked.save(update_fields=["payment_status", "payment_mode", "paid_at", "paid_by", "proof"])
    log_paid(user=user, invoice=locked)
    return locked, True


def mark_unpaid(*, invoice: Invoice, user) -> tuple[Invoice, bool]:
    """Owner correcting a mistake. The old proof image is NOT deleted: it stays (still counted as
    attached) until the retention period ends, as an audit trail."""
    with transaction.atomic():
        locked = Invoice.objects.select_for_update().get(id=invoice.id)
        if locked.status == InvoiceStatus.VOID:
            raise InvoiceValidationError({"status": "A void invoice's payment can't be changed."})
        if locked.payment_status == PaymentStatus.UNPAID:
            return locked, False
        old_mode, old_proof_id = locked.payment_mode, locked.proof_id
        locked.payment_status = PaymentStatus.UNPAID
        locked.payment_mode = ""
        locked.paid_at = None
        locked.paid_by = None
        locked.proof = None
        locked.save(update_fields=["payment_status", "payment_mode", "paid_at", "paid_by", "proof"])
    log_action(
        user=user,
        action="invoice.unpaid",
        business=locked.business,
        invoice_id=locked.id,
        number=locked.number,
        old_mode=old_mode,
        old_proof_id=old_proof_id,
    )
    return locked, True
