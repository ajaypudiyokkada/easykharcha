from django.conf import settings
from django.db import models

from businesses.models import Business


class AlertCheck(models.Model):
    """One row per alert a human has acknowledged. `alert_key` matches the `key` compute_alerts()
    gives the same alert — unique per business, so checking an alert hides it only until its key
    changes (new date or new underlying data), never forever."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="alert_checks")
    alert_key = models.CharField(max_length=160)
    checked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="alert_checks"
    )
    checked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["business", "alert_key"], name="unique_alert_check_per_business_key"
            )
        ]

    def __str__(self) -> str:
        return f"{self.alert_key} checked on business {self.business_id}"
