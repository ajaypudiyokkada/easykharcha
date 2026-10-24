from django.contrib import admin

from config.admin_mixins import ReadOnlyAdminMixin, ReadOnlyInlineMixin
from stock.units import display_quantity

from .models import CountLine, StockCount


class CountLineInline(ReadOnlyInlineMixin, admin.TabularInline):
    model = CountLine
    extra = 0
    fields = ("stock_item", "counted_qty_display", "state", "confirmed_unusual")
    readonly_fields = ("stock_item", "counted_qty_display", "state", "confirmed_unusual")

    @admin.display(description="Counted qty")
    def counted_qty_display(self, obj: CountLine):
        if obj.counted_qty is None:
            return None
        qty, unit = display_quantity(obj.counted_qty, obj.stock_item.unit)
        return f"{qty} {unit}"


@admin.register(StockCount)
class StockCountAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    """Blind stock counts — create-only by design, never edited or deleted here."""

    list_display = (
        "business",
        "count_type",
        "business_date",
        "counted_by",
        "is_late",
        "submitted_at",
    )
    list_filter = ("count_type", "is_late")
    search_fields = ("business__name", "counted_by__mobile", "counted_by__name")
    inlines = [CountLineInline]
