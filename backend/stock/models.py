from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models.functions import Lower

from businesses.models import Business

from .units import UnitFamily


class Unit(models.TextChoices):
    """A StockItem is locked to one unit for its whole life (see StockItemDetailView's unit-change
    refusal once purchased/counted), so every quantity ever recorded against it (purchases, counts,
    wastage, ingredient rows) is already in that same unit by the time it reaches the server — the
    backend itself never converts between units. Step 22a's dish form is the one place a g<->kg or
    ml<->L conversion happens at all, purely client-side at entry time (see
    mobile/src/forms/unitConversion.ts), so the owner can type "150 g" against a kg-denominated
    stock item; everything described above still holds once that's converted. Adding a label here
    with no sibling in that conversion table is still purely cosmetic and needs no gap-maths change.

    Step U1b-1: `kg`/`L`/`tonne` remain valid choices here for now (U1b-2 narrows what a *new*
    stock item can store as its own `unit`) but every *existing* row using one of them has already
    been rebased to its family's base unit (g/ml) by the base-unit migration — see `StockItem.
    unit_family`/`units.py`."""

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


class LowStockCategory(models.TextChoices):
    """Step 41b1b3a (docs/BASES_PLAN.md sec 8.3): the default days-of-cover a stock item's low-stock
    threshold rests on when no per-item override is set — see stock/low_stock.py's
    LOW_STOCK_CATEGORY_DEFAULT_DAYS. New rows default from `goes_off` (True -> PERISHABLE, False ->
    DRY_STAPLES, the same binary split the base-unit/goes_off migrations already use) — FRESH_SEMI
    and PACKAGING_CLEANING only ever come from an explicit Owner/Manager choice via the thresholds
    endpoint."""

    PERISHABLE = "perishable", "Perishable"
    FRESH_SEMI = "fresh_semi", "Fresh / semi-perishable"
    DRY_STAPLES = "dry_staples", "Dry staples"
    PACKAGING_CLEANING = "packaging_cleaning", "Packaging and cleaning"


class StockItem(models.Model):
    """Something a business buys. No recipes, quantities or costing here yet — just what it is."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="stock_items")
    name = models.CharField(max_length=120)
    unit = models.CharField(max_length=10, choices=Unit.choices)
    # Step U1b-1: derived from `unit` via `units.unit_family()` — set once at creation, backfilled
    # for existing rows by the base-unit migration. Locked the same way `unit` is locked, once this
    # item has any purchase/count/wastage/sale history (see StockItemDetailView.patch), so a family
    # change can never retroactively rescale a past row.
    unit_family = models.CharField(
        max_length=10, choices=UnitFamily.CHOICES, default=UnitFamily.COUNT
    )
    # "1 pack unit = N base units" (e.g. 1 packet = 500 g, 1 bottle = 750 ml) — only meaningful for
    # a packaged/pack-style entry unit. Set once but, unlike `unit`/`unit_family`, never locked by
    # history (Decision 3, U1b-1 report): every past row is already stored in the base unit, never
    # in packs, so correcting a pack's real-world size can't rescale anything already recorded.
    pack_size_base_qty = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)
    # Step U1b-1: widened 2dp->4dp, max_digits 10->12 (Decision 1) — this is a price *per base
    # unit* (g/ml/piece) now, not per kg/L/piece, so 2dp alone would floor a cheap-per-kg item
    # (e.g. ₹0.05/kg flour) straight to ₹0.00/g. Still displayed to the owner per kg/L (x1000),
    # never typed or stored that way.
    usual_price = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
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
    # Step 41b1b3a: low-stock threshold inputs — see stock/low_stock.py for how they combine into
    # an effective threshold. `low_stock_category` picks the default days of cover
    # (LOW_STOCK_CATEGORY_DEFAULT_DAYS); `low_stock_days_override` replaces that default for this
    # one item; `low_stock_fixed_qty` (base units) is an absolute floor, used instead of the
    # days-of-cover figure whenever it's larger (or whenever there's no usage data yet to compute
    # days-of-cover from at all).
    low_stock_category = models.CharField(
        max_length=20, choices=LowStockCategory.choices, default=LowStockCategory.DRY_STAPLES
    )
    low_stock_days_override = models.PositiveIntegerField(null=True, blank=True)
    low_stock_fixed_qty = models.DecimalField(
        max_digits=10, decimal_places=3, null=True, blank=True
    )
    active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="stock_items_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    # Step EK-4b: `ek:<run_id>:ing:<key>` for an item this business's EK setup apply created, blank
    # otherwise (including an item an apply call merely *linked* via `existing_item_id`) — lets a
    # repeated apply call for the same run recognise its own earlier work instead of re-creating it.
    ek_key = models.CharField(max_length=60, blank=True, default="")

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
    # Step EK-4b: `ek:<run_id>:recipe:<dish_id>` once an EK setup apply has written this dish's
    # ingredient/base rows as an UNCONFIRMED estimate — blank for a dish whose recipe the owner
    # built by hand, or one an EK apply call skipped (already confirmed, or the dish was deleted).
    # A second apply for the same run only ever touches a dish still carrying its own ek_key.
    ek_key = models.CharField(max_length=60, blank=True, default="")

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


# Step U2b1b2 (docs/BASES_PLAN.md secs 1-2): a Base is always defined per 1,000 g or 1,000 ml of
# finished batch, never per-piece — so its own unit_family is restricted to the two convertible
# families, unlike StockItem.unit_family which also allows count.
BASE_UNIT_FAMILY_CHOICES = [
    (UnitFamily.WEIGHT, "Weight"),
    (UnitFamily.VOLUME, "Volume"),
]


class Base(models.Model):
    """A prep item batched ahead of time (e.g. "onion-tomato masala") — its raw formula lives in
    BaseIngredient, how much of it a dish uses per portion lives in SellItemBase. See
    docs/BASES_PLAN.md secs 1-2."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="bases")
    name = models.CharField(max_length=120)
    unit_family = models.CharField(max_length=10, choices=BASE_UNIT_FAMILY_CHOICES)
    # Step 42b1c1: the batch size BaseIngredient.quantity_per_1000 rows are actually defined
    # against — defaults to 1,000 (the plan's original "always per 1,000 g/ml" assumption) but an
    # owner can record a real batch size that isn't a round 1,000 (e.g. a 1,200 g batch) without
    # needing to rescale every ingredient row by hand. The column name on BaseIngredient stays
    # `quantity_per_1000` (pre-dates this field); stock/base_expansion.py divides by this field,
    # not a hardcoded 1,000.
    batch_yield_qty = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal("1000"))
    active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="bases_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    # Step EK-4b: `ek:<run_id>:base:<key>` for a base an EK setup apply created — see
    # StockItem.ek_key's docstring, same idempotency role.
    ek_key = models.CharField(max_length=60, blank=True, default="")

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(Lower("name"), "business", name="unique_base_name_per_business")
        ]

    def __str__(self) -> str:
        return self.name


class BaseIngredient(models.Model):
    """One raw line of a base's batch formula: how much of `stock_item`, in grams/ml, goes into
    1,000 g/ml of finished `base`. `stock_item` can never be another Base — this FK only ever
    points at StockItem — so a base's formula is structurally one level deep, never nested. Same
    non-shared rule as SellItemIngredient (enforced where bases are created/edited, not here)."""

    base = models.ForeignKey(Base, on_delete=models.CASCADE, related_name="ingredients")
    stock_item = models.ForeignKey(
        StockItem, on_delete=models.PROTECT, related_name="used_in_bases"
    )
    quantity_per_1000 = models.DecimalField(max_digits=10, decimal_places=3)

    class Meta:
        ordering = ("id",)
        constraints = [
            models.UniqueConstraint(
                fields=["base", "stock_item"], name="unique_ingredient_per_base"
            )
        ]

    def __str__(self) -> str:
        return f"{self.base.name} uses {self.quantity_per_1000}/1000 {self.stock_item.name}"


class SellItemBase(models.Model):
    """The dish-to-base link, parallel to SellItemIngredient: how much of `base` (grams/ml, in the
    base's own batch unit) one portion of `sell_item` uses. A dish's full recipe is its
    `ingredients` (direct raw) plus its `bases` (formula raw) together."""

    sell_item = models.ForeignKey(SellItem, on_delete=models.CASCADE, related_name="bases")
    base = models.ForeignKey(Base, on_delete=models.PROTECT, related_name="used_in")
    quantity = models.DecimalField(max_digits=10, decimal_places=3)

    class Meta:
        ordering = ("id",)
        constraints = [
            models.UniqueConstraint(fields=["sell_item", "base"], name="unique_base_per_dish")
        ]

    def __str__(self) -> str:
        return f"{self.sell_item.name} uses {self.quantity} of base {self.base.name}"
