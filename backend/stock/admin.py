from django.contrib import admin

from .models import SellItem, StockItem


@admin.register(StockItem)
class StockItemAdmin(admin.ModelAdmin):
    list_display = ("name", "business", "unit", "usual_price", "active", "shared")
    list_filter = ("unit", "active", "shared", "goes_off")
    search_fields = ("name", "business__name")


@admin.register(SellItem)
class SellItemAdmin(admin.ModelAdmin):
    list_display = ("name", "business", "selling_price", "main_stock_item", "active")
    list_filter = ("active",)
    search_fields = ("name", "business__name")
