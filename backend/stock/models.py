from django.conf import settings
from django.db import models
from django.db.models.functions import Lower

from businesses.models import Business


class Unit(models.TextChoices):
    KG = "kg", "kg"
    G = "g", "g"
    L = "L", "L"
    ML = "ml", "ml"
    PIECE = "piece", "piece"
    PACK = "pack", "pack"


class StockItem(models.Model):
    """Something a business buys. No recipes, quantities or costing here yet — just what it is."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="stock_items")
    name = models.CharField(max_length=120)
    unit = models.CharField(max_length=10, choices=Unit.choices)
    usual_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    supplier = models.CharField(max_length=120, blank=True)
    # "Used in many items" — oil, salt, packaging. A shared item can't be a sell item's main
    # ingredient (see SellItem.main_stock_item) since it doesn't point to any one thing sold.
    shared = models.BooleanField(default=False)
    goes_off = models.BooleanField(default=False)
    shelf_life_days = models.PositiveIntegerField(null=True, blank=True)
    active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="stock_items_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                Lower("name"), "business", name="unique_stock_item_name_per_business"
            )
        ]

    def __str__(self) -> str:
        return self.name


class SellItem(models.Model):
    """Something a business sells. No recipes or costing here yet — just what it is, and optionally
    the one stock item it's mainly made from."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="sell_items")
    name = models.CharField(max_length=120)
    selling_price = models.DecimalField(max_digits=10, decimal_places=2)
    main_stock_item = models.ForeignKey(
        StockItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sell_items",
    )
    active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="sell_items_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                Lower("name"), "business", name="unique_sell_item_name_per_business"
            )
        ]

    def __str__(self) -> str:
        return self.name
