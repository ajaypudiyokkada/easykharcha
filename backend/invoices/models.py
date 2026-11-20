from django.conf import settings
from django.db import models

from businesses.models import Business
from sales.models import Sale
from stock.models import SellItem


class InvoiceSource(models.TextChoices):
    CREATED = "created", "Created"


class InvoiceStatus(models.TextChoices):
    POSTED = "posted", "Posted"
    VOID = "void", "Void"


class InvoiceSequence(models.Model):
    """One row per business holding the last number handed out. Locked with select_for_update inside
    the same transaction that saves the invoice (invoices/service.py), so a failed save rolls the
    counter back too — no gaps — and two concurrent saves can't read the same value — no duplicates."""

    business = models.OneToOneField(Business, on_delete=models.CASCADE, related_name="invoice_seq")
    last_number = models.PositiveIntegerField(default=0)

    def __str__(self) -> str:
        return f"Invoice sequence for business {self.business_id}: {self.last_number}"


class Invoice(models.Model):
    """A customer bill made inside EasyKharcha (not a tax invoice). Saving it also records the sale:
    each InvoiceLine owns its own Sale row. Voiding soft-deletes those rows; the number is kept."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="invoices")
    number = models.CharField(max_length=40)
    sequence_no = models.PositiveIntegerField()
    source = models.CharField(
        max_length=10, choices=InvoiceSource.choices, default=InvoiceSource.CREATED
    )
    status = models.CharField(
        max_length=10, choices=InvoiceStatus.choices, default=InvoiceStatus.POSTED
    )
    sale_date = models.DateField()
    customer_name = models.CharField(max_length=120, blank=True, default="")
    customer_phone = models.CharField(max_length=15, blank=True, default="")
    # Amounts before tax; tax is a flat rate ADDED ON TOP (set per business, off by default).
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    tax_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=12, decimal_places=2)
    # Client-generated; a retried save with the same key returns the first invoice, never a second.
    idempotency_key = models.CharField(max_length=64, null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="invoices_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invoices_voided",
    )
    voided_at = models.DateTimeField(null=True, blank=True)
    void_reason = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        ordering = ("-sequence_no",)
        constraints = [
            models.UniqueConstraint(fields=["business", "number"], name="unique_invoice_number"),
            models.UniqueConstraint(
                fields=["business", "sequence_no"], name="unique_invoice_sequence_no"
            ),
            # NULLs never collide, so invoices saved without a key are unaffected.
            models.UniqueConstraint(
                fields=["business", "idempotency_key"], name="unique_invoice_idempotency_key"
            ),
        ]

    def __str__(self) -> str:
        return self.number


class InvoiceLine(models.Model):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="lines")
    sell_item = models.ForeignKey(SellItem, on_delete=models.PROTECT, related_name="invoice_lines")
    # The item's name when the bill was made — a later rename never rewrites a printed bill.
    name = models.CharField(max_length=120)
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    rate = models.DecimalField(max_digits=10, decimal_places=2)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    # This line's own Sale row (many Sale rows per item per date are allowed, so nothing is merged).
    sale = models.OneToOneField(Sale, on_delete=models.PROTECT, related_name="invoice_line")
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ("position", "id")

    def __str__(self) -> str:
        return f"{self.quantity} x {self.name}"
