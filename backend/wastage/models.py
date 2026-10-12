from django.conf import settings
from django.db import models

from businesses.models import Business
from stock.models import StockItem


class WastageReason(models.TextChoices):
    SPILLAGE = "spillage", "Spillage"
    SPOILED = "spoiled", "Spoiled"
    OVER_PREPARED = "over_prepared", "Over-prepared"
    DAMAGED = "damaged", "Damaged"
    OTHER = "other", "Other"


class WastageEntry(models.Model):
    """What was lost and why. Soft-deleted, never hard-deleted, same as a Purchase — a deleted entry
    disappears from every list but stays in the database for the audit trail."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="wastage_entries")
    stock_item = models.ForeignKey(
        StockItem, on_delete=models.PROTECT, related_name="wastage_entries"
    )
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    reason = models.CharField(max_length=20, choices=WastageReason.choices)
    note = models.CharField(max_length=500, blank=True)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="wastage_entries_recorded"
    )
    recorded_at = models.DateTimeField(auto_now_add=True)
    # The item's last purchase price at the moment this entry was recorded, falling back to its
    # usual price, else null — captured once here so a later price change never silently rewrites
    # the value of an old entry.
    unit_cost_at_entry = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    is_deleted = models.BooleanField(default=False)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="wastage_entries_deleted",
    )
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-recorded_at", "-id")

    def __str__(self) -> str:
        return f"{self.quantity} of stock item {self.stock_item_id} wasted ({self.reason})"
