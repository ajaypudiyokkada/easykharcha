from django.contrib import admin

from config.admin_mixins import ReadOnlyAdminMixin

from .models import WastageEntry


@admin.register(WastageEntry)
class WastageEntryAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    """Wastage — create-only ledger data by design, never edited or deleted here (the app's own
    soft-delete via `is_deleted` is the only way an entry goes away)."""

    list_display = (
        "id",
        "business",
        "stock_item",
        "quantity",
        "reason",
        "recorded_by",
        "recorded_at",
        "is_deleted",
    )
    list_filter = ("reason", "is_deleted")
    search_fields = ("business__name", "stock_item__name")
