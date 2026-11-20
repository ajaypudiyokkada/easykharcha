import re
from datetime import timedelta
from decimal import Decimal

from rest_framework import serializers

from sales.service import business_today

from .models import Invoice, InvoiceLine

ZERO = Decimal("0")
MIN_QUANTITY = Decimal("0.001")
OLD_DATE_DAYS = 7
_MOBILE = re.compile(r"^[6-9][0-9]{9}$")


def normalise_indian_mobile(raw: str) -> str:
    """'98765 43210', '+91 98765-43210', '919876543210' and '09876543210' all become
    '+919876543210'. Anything else is rejected."""
    digits = re.sub(r"[\s\-()]", "", raw)
    if digits.startswith("+91"):
        digits = digits[3:]
    elif len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if not _MOBILE.match(digits):
        raise serializers.ValidationError("Enter a 10-digit Indian mobile number.")
    return f"+91{digits}"


class InvoiceLineInputSerializer(serializers.Serializer):
    """Format checks only; that the item belongs to this business and is active is checked in
    service.py. `rate` defaults to the item's selling price. `amount`, if sent, must equal
    quantity x rate (within 0.01): the server always computes it."""

    sell_item = serializers.IntegerField()
    quantity = serializers.DecimalField(max_digits=10, decimal_places=3, min_value=MIN_QUANTITY)
    rate = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True, min_value=ZERO
    )
    amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True, min_value=ZERO
    )


class InvoiceCreateSerializer(serializers.Serializer):
    sale_date = serializers.DateField()
    customer_name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    customer_phone = serializers.CharField(required=False, allow_blank=True, max_length=20)
    idempotency_key = serializers.CharField(max_length=64, required=False, allow_blank=True)
    # Optional client-side totals, only ever checked against the server's own (never trusted).
    subtotal = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True
    )
    tax_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True
    )
    total = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True
    )

    def validate_customer_phone(self, value):
        value = value.strip()
        return normalise_indian_mobile(value) if value else ""


class InvoiceLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceLine
        fields = (
            "id",
            "kind",
            "sell_item",
            "name",
            "name_as_printed",
            "quantity",
            "rate",
            "amount",
            "recorded_amount",
            "sale",
        )


class InvoiceSerializer(serializers.ModelSerializer):
    lines = InvoiceLineSerializer(many=True, read_only=True)
    date_is_old = serializers.SerializerMethodField()
    proof_available = serializers.SerializerMethodField()
    proof_removed = serializers.SerializerMethodField()
    proof_already_used = serializers.SerializerMethodField()
    lines_recorded = serializers.SerializerMethodField()
    lines_total = serializers.SerializerMethodField()
    bill_photo_available = serializers.SerializerMethodField()
    bill_photo_removed = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = (
            "id",
            "number",
            "source",
            "status",
            "sale_date",
            "date_is_old",
            "customer_name",
            "customer_phone",
            "subtotal",
            "tax_rate",
            "tax_amount",
            "total",
            "created_at",
            "voided_at",
            "void_reason",
            "payment_status",
            "payment_mode",
            "paid_at",
            "proof_available",
            "proof_removed",
            "proof_already_used",
            "bill_number_printed",
            "bill_date_printed",
            "bill_date",
            "partly_recorded",
            "lines_recorded",
            "lines_total",
            "printed_items_total",
            "discount_total",
            "tax_lines",
            "round_off",
            "bill_photo_available",
            "bill_photo_removed",
            "lines",
        )

    def get_lines_recorded(self, obj) -> int:
        """Lines that became a sale (kind item), out of lines_total."""
        return sum(1 for line in obj.lines.all() if line.kind == "item")

    def get_lines_total(self, obj) -> int:
        return len(obj.lines.all())

    def _import_image(self, obj):
        record = getattr(obj, "invoice_import", None)
        return record.image if record is not None else None

    def get_bill_photo_available(self, obj) -> bool:
        image = self._import_image(obj)
        return image is not None and image.removed_at is None

    def get_bill_photo_removed(self, obj) -> bool:
        image = self._import_image(obj)
        return image is not None and image.removed_at is not None

    def get_proof_available(self, obj) -> bool:
        """The proof image is still stored."""
        return obj.proof is not None and obj.proof.removed_at is None

    def get_proof_removed(self, obj) -> bool:
        """There was a proof, but the retention period ended and it was purged."""
        return obj.proof is not None and obj.proof.removed_at is not None

    def get_proof_already_used(self, obj) -> bool:
        """Warning only: the same photo (by hash of the original upload) is attached to another
        invoice of this business. Never blocks anything."""
        if obj.proof is None:
            return False
        return (
            Invoice.objects.filter(business_id=obj.business_id, proof__sha256=obj.proof.sha256)
            .exclude(id=obj.id)
            .exists()
        )

    def get_date_is_old(self, obj) -> bool:
        """True when the bill is dated more than 7 days back (still allowed; a nudge to double-check)."""
        return obj.sale_date < business_today(obj.business) - timedelta(days=OLD_DATE_DAYS)


class InvoiceSettingsSerializer(serializers.Serializer):
    invoice_tax_enabled = serializers.BooleanField()
    invoice_tax_rate = serializers.DecimalField(
        max_digits=5, decimal_places=2, min_value=ZERO, max_value=Decimal("100")
    )
    bill_address = serializers.CharField(max_length=240, allow_blank=True)
    bill_phone = serializers.CharField(max_length=20, allow_blank=True)
    bill_gstin = serializers.CharField(max_length=20, allow_blank=True)
