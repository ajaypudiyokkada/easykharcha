from django.contrib import admin

from config.admin_mixins import ReadOnlyAdminMixin, ReadOnlyInlineMixin

from .models import Purchase, PurchaseLine


class PurchaseLineInline(ReadOnlyInlineMixin, admin.TabularInline):
    model = PurchaseLine
    extra = 0
    fields = ("stock_item", "quantity", "unit_price", "line_total")


@admin.register(Purchase)
class PurchaseAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    """Purchases — create-only ledger data by design, never edited or deleted here (the app's own
    soft-delete via `is_deleted` is the only way a purchase goes away)."""

    list_display = (
        "id",
        "business",
        "supplier",
        "purchase_date_time",
        "total_amount",
        "is_deleted",
    )
    list_filter = ("is_deleted",)
    search_fields = ("business__name", "supplier__name", "note")
    inlines = [PurchaseLineInline]
