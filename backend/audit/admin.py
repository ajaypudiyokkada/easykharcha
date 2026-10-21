from django.contrib import admin

from config.admin_mixins import ReadOnlyAdminMixin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    """Append-only by design — never edited or deleted here."""

    list_display = ("action", "user", "business", "created_at")
    list_filter = ("action",)
    search_fields = ("action", "user__mobile", "user__name", "business__name")
