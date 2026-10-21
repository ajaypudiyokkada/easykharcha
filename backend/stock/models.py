from django.conf import settings
from django.db import models
from django.db.models.functions import Lower

from businesses.models import Business


class Unit(models.TextChoices):
    """No conversion between these exists anywhere (not even g<->kg) — a StockItem is locked to one
    unit for its whole life (see StockItemDetailView's unit-change refusal once purchased/counted),
    so every quantity ever recorded against it (purchases, counts, wastage, uses_qty) is already in
    that same unit. Adding a label here is purely cosmetic and needs no gap-maths change."""

    KG = "kg", "kg"
    G = "g", "g"
    L = "L", "L"
    ML = "ml", "ml"
    PIECE = "piece", "piece"
    PACK = "pack", "pack"
    DOZEN = "dozen", "dozen"
    TONNE = "tonne", "tonne"
    M = "m", "m"
    SHEET = "sheet", "sheet"
    ROLL = "roll", "roll"
    SET = "set", "set"
    BOX = "box", "box"
    BAG = "bag", "bag"
    TRAY = "tray", "tray"
    BOTTLE = "bottle", "bottle"


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
    # Step 19: free text, blank means "Ungrouped" — canonicalised case-insensitively against this
    # business's other stock-item groups in the view (see stock/views.py's _canonical_group), the
    # same split as name-uniqueness: format-only here, anything needing a query lives in the view.
    group = models.CharField(max_length=40, blank=True, default="")
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
    # How much of main_stock_item ONE unit sold uses, in that item's own unit (e.g. one Veg Biryani
    # uses 0.3 kg of Rice) — lets a later step compare what was sold against what was used. Only
    # meaningful alongside main_stock_item; enforced in the serializer/view, not a DB constraint.
    uses_qty = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)
    # Step 19: same as StockItem.group — its own namespace, not shared with stock-item groups.
    group = models.CharField(max_length=40, blank=True, default="")
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
