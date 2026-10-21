from django.conf import settings
from django.db import models
from django.db.models.functions import Lower

from businesses.models import Business


class Unit(models.TextChoices):
    """A StockItem is locked to one unit for its whole life (see StockItemDetailView's unit-change
    refusal once purchased/counted), so every quantity ever recorded against it (purchases, counts,
    wastage, ingredient rows) is already in that same unit by the time it reaches the server — the
    backend itself never converts between units. Step 22a's dish form is the one place a g<->kg or
    ml<->L conversion happens at all, purely client-side at entry time (see
    mobile/src/forms/unitConversion.ts), so the owner can type "150 g" against a kg-denominated
    stock item; everything described above still holds once that's converted. Adding a label here
    with no sibling in that conversion table is still purely cosmetic and needs no gap-maths change."""

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
    # "Used in many items" — oil, salt, packaging. A shared item can't be picked as a dish's
    # ingredient (see SellItemIngredient) since it doesn't point to any one thing sold.
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


class RecipeStatus(models.TextChoices):
    """Step 22a: how complete and trustworthy a dish's ingredient list is. `NONE` is the default for
    anything created without ingredients (e.g. the no-ingredients bulk endpoint); `CONFIRMED` is set
    the moment the manual dish form saves at least one ingredient row. `UNCONFIRMED` is a clean
    extension point for a future AI/scan flow that would pre-fill estimated ingredient rows for the
    owner to review — nothing in this step ever sets it."""

    NONE = "none", "none"
    UNCONFIRMED = "unconfirmed", "unconfirmed"
    CONFIRMED = "confirmed", "confirmed"


class SellItem(models.Model):
    """Something a business sells — a "dish" in food wording, see sectorCopy. Its ingredients (what
    stock items, and how much of each per portion) live in SellItemIngredient, not here."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="sell_items")
    name = models.CharField(max_length=120)
    selling_price = models.DecimalField(max_digits=10, decimal_places=2)
    # Step 22a: short free text, e.g. "1 plate" or "6 pieces" — purely descriptive, not used in any
    # maths (ingredient quantities below are already "per one portion").
    portion_label = models.CharField(max_length=40, blank=True, default="")
    recipe_status = models.CharField(
        max_length=12, choices=RecipeStatus.choices, default=RecipeStatus.NONE
    )
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


class SellItemIngredient(models.Model):
    """One stock item used per ONE portion of a dish, in the stock item's own unit (e.g. one Veg
    Biryani uses 0.3 kg of Rice) — replaces the old single main_stock_item/uses_qty pair (Step 22a)
    so a dish can carry more than one ingredient. Gap maths (counts/gap.py) only trusts these once
    the owning SellItem's recipe_status is CONFIRMED."""

    sell_item = models.ForeignKey(SellItem, on_delete=models.CASCADE, related_name="ingredients")
    # PROTECT, not SET_NULL: a stock item still named in a recipe is "in use" the same way
    # StockItemDetailView already refuses to deactivate one — see its blocking check. Deleting a
    # stock item is itself rare (only businesses/sector_change.py does it, and only after confirming
    # nothing still points at it), so this is a backstop, not a path the app exercises normally.
    stock_item = models.ForeignKey(StockItem, on_delete=models.PROTECT, related_name="used_in")
    quantity = models.DecimalField(max_digits=10, decimal_places=3)

    class Meta:
        ordering = ("id",)
        constraints = [
            models.UniqueConstraint(
                fields=["sell_item", "stock_item"], name="unique_ingredient_per_dish"
            )
        ]

    def __str__(self) -> str:
        return f"{self.sell_item.name} uses {self.quantity} {self.stock_item.unit} {self.stock_item.name}"
