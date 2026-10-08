from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """Append-only record of every create/edit/delete.

    Non-negotiable #2: edits and deletes carry before/after values. PINs never reach this table — see
    `audit.services.scrub`, which is the only writer.
    """

    at = models.DateTimeField(auto_now_add=True, db_index=True)
    business = models.ForeignKey(
        "tenants.Business",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="audit_logs"
    )
    #: Dotted verb, e.g. "wastage.create", "sale.delete", "access.grant_super_admin"
    action = models.CharField(max_length=64, db_index=True)
    #: Human-readable one-liner shown in the Audit screen without expanding the detail.
    summary = models.CharField(max_length=255, blank=True)
    #: {"before": {...}, "after": {...}, ...} — scrubbed of secrets.
    detail = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("-at", "-id")
        indexes = [models.Index(fields=["business", "-at"])]

    def __str__(self) -> str:
        return f"{self.at:%Y-%m-%d %H:%M} {self.action} {self.summary}"
