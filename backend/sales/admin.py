from django.contrib import admin

from config.admin_mixins import ReadOnlyAdminMixin

from .models import Sale


@admin.register(Sale)
class SaleAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    """Sales — create-only ledger data by design, never edited or deleted here (the app's own
    soft-delete via `is_deleted` is the only way a sale goes away)."""

    list_display = (
        "id",
        "business",
        "sell_item",
        "business_date",
        "quantity",
        "amount",
        "is_deleted",
    )
    list_filter = ("is_deleted", "source")
    search_fields = ("business__name", "sell_item__name")
