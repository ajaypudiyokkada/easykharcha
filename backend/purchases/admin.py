from django.contrib import admin

from config.admin_mixins import ReadOnlyAdminMixin, ReadOnlyInlineMixin
from stock.units import display_price_per_major_unit, display_quantity

from .models import Purchase, PurchaseLine


class PurchaseLineInline(ReadOnlyInlineMixin, admin.TabularInline):
    model = PurchaseLine
    extra = 0
    fields = ("stock_item", "quantity_display", "unit_price_display", "line_total")
    readonly_fields = ("stock_item", "quantity_display", "unit_price_display", "line_total")

    @admin.display(description="Quantity")
    def quantity_display(self, obj: PurchaseLine):
        qty, unit = display_quantity(obj.quantity, obj.stock_item.unit)
        return f"{qty} {unit}"

    @admin.display(description="Price (per kg/L)")
    def unit_price_display(self, obj: PurchaseLine):
        return display_price_per_major_unit(obj.unit_price, obj.stock_item.unit)


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
