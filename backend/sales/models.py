from django.conf import settings
from django.db import models

from businesses.models import Business
from stock.models import SellItem


class SaleSource(models.TextChoices):
    MANUAL = "manual", "Manual"


class Sale(models.Model):
    """One sell item's units sold on one business-local calendar date. Soft-deleted, never
    hard-deleted, same as a Purchase or a WastageEntry. `source` is always "manual" for now — the
    Petpooja upload this step deliberately doesn't build will add another value later."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="sales")
    sell_item = models.ForeignKey(SellItem, on_delete=models.PROTECT, related_name="sales")
    business_date = models.DateField()
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    source = models.CharField(max_length=10, choices=SaleSource.choices, default=SaleSource.MANUAL)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="sales_recorded"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    is_deleted = models.BooleanField(default=False)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sales_deleted",
    )
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-business_date", "-created_at", "-id")

    def __str__(self) -> str:
        return f"{self.quantity} of sell item {self.sell_item_id} sold on {self.business_date}"
