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


class PaymentStatus(models.TextChoices):
    UNPAID = "unpaid", "Unpaid"
    PAID = "paid", "Paid"


class PaymentMode(models.TextChoices):
    CASH = "cash", "Cash"
    UPI = "upi", "UPI"
    CARD = "card", "Card"
    BANK_TRANSFER = "bank_transfer", "Bank transfer"


class StoredImageKind(models.TextChoices):
    PAYMENT_PROOF = "payment_proof", "Payment proof"
    IMPORTED_BILL = "imported_bill", "Imported bill"


class StoredImage(models.Model):
    """A photo kept in PRIVATE_MEDIA_ROOT (never the public MEDIA_ROOT): a payment proof now, an
    imported bill photo later. The file is the compressed, EXIF-stripped copy; `sha256` is of the
    ORIGINAL upload so the same photo is recognised even though it's re-encoded. `uploaded_at` is the
    retention clock; the purge sets `removed_at` and deletes the file but keeps this row. `attached`
    turns true once an invoice uses it (and stays true), so a never-used upload can be cleaned up
    after a day without touching anything an invoice ever referenced."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="stored_images")
    kind = models.CharField(max_length=20, choices=StoredImageKind.choices)
    # Relative to PRIVATE_MEDIA_ROOT, a random name we chose, never the client's file name.
    path = models.CharField(max_length=120)
    sha256 = models.CharField(max_length=64, db_index=True)
    size = models.PositiveIntegerField()
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)
    removed_at = models.DateTimeField(null=True, blank=True)
    attached = models.BooleanField(default=False)

    class Meta:
        ordering = ("-uploaded_at", "-id")

    def __str__(self) -> str:
        return f"{self.kind} {self.id} (business {self.business_id})"


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
    # Payment is a label on the invoice only: it never changes sales or stock maths. Full payment only.
    payment_status = models.CharField(
        max_length=10, choices=PaymentStatus.choices, default=PaymentStatus.UNPAID
    )
    payment_mode = models.CharField(
        max_length=20, choices=PaymentMode.choices, blank=True, default=""
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    paid_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invoices_paid",
    )
    proof = models.ForeignKey(
        StoredImage, on_delete=models.SET_NULL, null=True, blank=True, related_name="invoices"
    )

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


class ImportStatus(models.TextChoices):
    QUEUED = "queued", "queued"
    READING = "reading", "reading"
    READY = "ready", "ready"
    FAILED = "failed", "failed"
    ABANDONED = "abandoned", "abandoned"


class InvoiceImport(models.Model):
    """One uploaded bill (from another billing system) being read by the AI worker (Step S4a). It
    only ever holds a DRAFT: nothing here posts a sale or creates an invoice, the owner confirms in a
    later step. The photo (images only) is a StoredImage in the private store; a PDF is read from a
    temp file that is deleted right after the job and is never kept."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="invoice_imports")
    status = models.CharField(
        max_length=10, choices=ImportStatus.choices, default=ImportStatus.QUEUED
    )
    # NOT_READABLE, DAILY_LIMIT, AI_UNAVAILABLE, AI_PROVIDER_ERROR, AI_SCHEMA_INVALID, TIMEOUT, ...
    error_code = models.CharField(max_length=40, blank=True, default="")
    # For NOT_READABLE: blurred / cropped / not_a_bill / nothing_found.
    error_reason = models.CharField(max_length=20, blank=True, default="")
    image = models.ForeignKey(
        StoredImage, on_delete=models.SET_NULL, null=True, blank=True, related_name="imports"
    )
    media_type = models.CharField(max_length=30, blank=True, default="")
    # sha256 of the ORIGINAL uploaded bytes (image or PDF).
    file_sha256 = models.CharField(max_length=64, db_index=True)
    # Sub-folder of settings.AI_TEMP_ROOT holding a PDF until the job ends; blank for an image.
    temp_dir = models.CharField(max_length=64, blank=True, default="")
    # AI_FAKE only: which canned bill reading to return.
    fixture = models.CharField(max_length=40, blank=True, default="")
    draft = models.JSONField(null=True, blank=True)
    model_used = models.CharField(max_length=60, blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="invoice_imports"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    heartbeat = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    abandoned_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at", "-id")

    def __str__(self) -> str:
        return f"Invoice import {self.id} ({self.status}) for business {self.business_id}"


class AliasKind(models.TextChoices):
    ITEM = "item", "Item"
    NOT_ITEM = "not_item", "Not an item"


class SellItemAlias(models.Model):
    """A bill line name the owner has settled once, so the next import resolves it without asking:
    either "this name is that item you sell" or "this is not an item" (a parcel or service charge).
    Created only when the owner ticks "Remember this match" in the confirm step (Step S4c), never by
    the AI and never by matching. `normalized_alias` comes from normalize.normalize_name."""

    business = models.ForeignKey(
        Business, on_delete=models.CASCADE, related_name="sell_item_aliases"
    )
    normalized_alias = models.CharField(max_length=120)
    kind = models.CharField(max_length=10, choices=AliasKind.choices)
    sell_item = models.ForeignKey(
        SellItem, on_delete=models.CASCADE, null=True, blank=True, related_name="aliases"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["business", "normalized_alias"], name="unique_sell_item_alias"
            )
        ]

    def __str__(self) -> str:
        return f"{self.normalized_alias} -> {self.kind}"
