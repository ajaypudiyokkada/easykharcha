from django.contrib import admin

from .models import SellItem, StockItem
from .units import display_price_per_major_unit


@admin.register(StockItem)
class StockItemAdmin(admin.ModelAdmin):
    list_display = ("name", "business", "unit", "usual_price_display", "active", "shared")
    list_filter = ("unit", "active", "shared", "goes_off")
    search_fields = ("name", "business__name")

    @admin.display(description="Usual price (per kg/L)")
    def usual_price_display(self, obj: StockItem):
        return display_price_per_major_unit(obj.usual_price, obj.unit)


@admin.register(SellItem)
class SellItemAdmin(admin.ModelAdmin):
    list_display = ("name", "business", "selling_price", "portion_label", "recipe_status", "active")
    list_filter = ("active", "recipe_status")
    search_fields = ("name", "business__name")
