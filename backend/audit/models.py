from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """Who did what, when, on which business. The minimal shape asked for in Step 5 — nothing here
    is queried yet, this just makes sure every write is recorded from the start."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_logs",
    )
    business = models.ForeignKey(
        "businesses.Business",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_logs",
    )
    action = models.CharField(max_length=80)
    # Never put secrets here (passwords, tokens, raw file contents) — this table is never purged.
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.action} by {self.user_id} at {self.created_at}"
