from django.conf import settings
from django.db import models
from django.db.models.functions import Lower

from businesses.models import Business
from stock.models import StockItem


class Supplier(models.Model):
    """Who a business buys from. Created on the fly the first time an owner types a new name into a
    purchase — never a separate "add supplier" step."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="suppliers")
    name = models.CharField(max_length=120)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                Lower("name"), "business", name="unique_supplier_name_per_business"
            )
        ]

    def __str__(self) -> str:
        return self.name


class Purchase(models.Model):
    """What was bought in one trip/delivery — one or more line items from (usually) one supplier.
    Soft-deleted, never hard-deleted: a deleted purchase disappears from every list but stays in the
    database for the audit trail."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="purchases")
    supplier = models.ForeignKey(
        Supplier, on_delete=models.SET_NULL, null=True, blank=True, related_name="purchases"
    )
    purchase_date_time = models.DateTimeField()
    total_amount = models.DecimalField(max_digits=12, decimal_places=2)
    note = models.CharField(max_length=500, blank=True)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="purchases_recorded"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_deleted = models.BooleanField(default=False)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="purchases_deleted",
    )
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-purchase_date_time", "-id")

    def __str__(self) -> str:
        return f"Purchase {self.id} for business {self.business_id}"


class PurchaseLine(models.Model):
    """One stock item within a purchase. Uses the stock item's own unit — there's no separate unit
    picker here, so a line can never disagree with its item about what it's measured in."""

    purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, related_name="lines")
    stock_item = models.ForeignKey(
        StockItem, on_delete=models.PROTECT, related_name="purchase_lines"
    )
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    line_total = models.DecimalField(max_digits=12, decimal_places=2)

    def __str__(self) -> str:
        return f"{self.quantity} of stock item {self.stock_item_id} on purchase {self.purchase_id}"
