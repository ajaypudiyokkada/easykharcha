from django.conf import settings
from django.db import models

from businesses.models import Business
from stock.models import StockItem


class CountType(models.TextChoices):
    OPENING = "opening", "Opening"
    CLOSING = "closing", "Closing"


class StockCount(models.Model):
    """One submission (opening or closing) for one business on one business-local calendar date.
    Create-only for Helper and Head chef — there's no edit or delete here, by design: a blind count
    can't be changed after the fact, only reviewed."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="stock_counts")
    count_type = models.CharField(max_length=10, choices=CountType.choices)
    business_date = models.DateField()
    counted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="stock_counts_recorded"
    )
    submitted_at = models.DateTimeField(auto_now_add=True)
    deadline_at = models.DateTimeField()
    is_late = models.BooleanField(default=False)
    minutes_late = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ("-business_date", "-submitted_at")
        constraints = [
            models.UniqueConstraint(
                fields=["business", "count_type", "business_date"],
                name="unique_count_per_business_type_date",
            )
        ]

    def __str__(self) -> str:
        return f"{self.count_type} count for business {self.business_id} on {self.business_date}"


class CountLineState(models.TextChoices):
    COUNTED = "counted", "Counted"
    SKIPPED = "skipped", "Skipped"
    NOT_SURE = "not_sure", "Not sure"


class CountLine(models.Model):
    count = models.ForeignKey(StockCount, on_delete=models.CASCADE, related_name="lines")
    stock_item = models.ForeignKey(StockItem, on_delete=models.PROTECT, related_name="count_lines")
    counted_qty = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)
    state = models.CharField(max_length=10, choices=CountLineState.choices)
    # True once the person has been asked "is this really N?" and confirmed it — lets a resubmit
    # with the same unusual value through without asking again.
    confirmed_unusual = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["count", "stock_item"], name="unique_count_line_per_item"
            )
        ]

    def __str__(self) -> str:
        return f"{self.stock_item_id} on count {self.count_id}: {self.state}"
