from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models

from core.fields import money_field, percent_field, quantity_field
from core.models import TenantScopedModel, TimeStampedModel


class StockUnit(models.TextChoices):
    KG = "kg", "kg"
    GRAM = "g", "g"
    LITRE = "l", "litre"
    ML = "ml", "ml"
    PIECE = "pc", "piece"
    PACKET = "pkt", "packet"
    DOZEN = "dz", "dozen"


class RecipeUnit(models.TextChoices):
    GRAM = "g", "g"
    ML = "ml", "ml"
    PIECE = "pc", "piece"


class Confidence(models.TextChoices):
    """How much a recipe quantity is worth trusting (§5d).

    The distinction matters: a `typical` number is a starting point, and firing a variance alert off one
    would train the owner to ignore alerts.
    """

    OWNER_STATED = "owner_stated", "Owner stated"
    TYPICAL = "typical", "Typical"
    CALIBRATED = "calibrated", "Calibrated (measured here)"


class Vendor(TenantScopedModel):
    code = models.CharField(max_length=24)
    name = models.CharField(max_length=120)
    category = models.CharField(max_length=60, blank=True)
    contact = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    terms = models.CharField(max_length=120, blank=True)
    gst = models.CharField(max_length=20, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(fields=["business", "code"], name="unique_vendor_code")
        ]

    def __str__(self) -> str:
        return self.name

    @property
    def in_use(self) -> bool:
        return self.purchases.exists() or self.ingredients.exists()


class Ingredient(TenantScopedModel):
    code = models.CharField(max_length=24)
    name = models.CharField(max_length=120)
    category = models.CharField(max_length=60, blank=True)
    unit = models.CharField(max_length=5, choices=StockUnit.choices, default=StockUnit.KG)
    #: Standard rate per stock unit. Used when a range has no purchases to weight against.
    rate = money_field(default=Decimal("0"))
    vendor = models.ForeignKey(
        Vendor, on_delete=models.SET_NULL, null=True, blank=True, related_name="ingredients"
    )
    target_pct = percent_field(null=True, blank=True)
    waste_alert_pct = percent_field(null=True, blank=True)
    #: Misc/overhead (oil, spices, packaging). Pooled across all dishes rather than attributed to one,
    #: and never given a recipe line — see §5 and §5b.
    shared = models.BooleanField(default=False)
    #: Excluded from SLA and variance when false — things nobody counts daily.
    track = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    # -- recipe/variance support (v3.1) ----------------------------------------------------------
    canonical = models.ForeignKey(
        "recipes.CanonicalIngredient",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tenant_ingredients",
        help_text="Global tag that lets one template apply to every tenant's naming.",
    )
    piece_weight_g = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Overrides the canonical's average piece weight; cuts differ by supplier.",
    )
    recipe_unit = models.CharField(
        max_length=3, choices=RecipeUnit.choices, default=RecipeUnit.GRAM
    )
    #: e.g. 1000 g per kg. Converts recipe quantities into stock units.
    recipe_units_per_stock_unit = models.DecimalField(
        max_digits=12,
        decimal_places=4,
        default=Decimal("1"),
        validators=[MinValueValidator(Decimal("0.0001"))],
    )
    #: Usable fraction after trimming/cooking loss. 100 = no loss.
    yield_pct = percent_field(
        default=Decimal("100"), validators=[MinValueValidator(Decimal("0.01"))]
    )
    variance_alert_pct = percent_field(null=True, blank=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(fields=["business", "code"], name="unique_ingredient_code")
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.unit})"

    def clean(self):
        if self.shared and self.recipe_lines.exists():
            raise ValidationError(
                {
                    "shared": "This ingredient has recipe lines. Shared ingredients stay pooled (§5b)."
                }
            )

    @property
    def effective_piece_weight_g(self) -> Decimal | None:
        if self.piece_weight_g is not None:
            return self.piece_weight_g
        return self.canonical.avg_piece_weight_g if self.canonical else None


class Dish(TenantScopedModel):
    code = models.CharField(max_length=24)
    name = models.CharField(max_length=120)
    section = models.CharField(max_length=60, blank=True)
    price = money_field(default=Decimal("0"))
    #: Primary ingredient. Required, and may not be a shared one (validated in clean() and serializer).
    ing = models.ForeignKey(
        Ingredient,
        on_delete=models.PROTECT,
        related_name="primary_dishes",
        verbose_name="primary ingredient",
    )
    active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    #: The item name as it appears in the POS export, for sales-import matching (§5c).
    pos_alias = models.CharField(max_length=160, blank=True)

    class Meta:
        ordering = ("section", "name")
        verbose_name_plural = "dishes"
        constraints = [
            models.UniqueConstraint(fields=["business", "code"], name="unique_dish_code")
        ]

    def __str__(self) -> str:
        return self.name

    def clean(self):
        if self.ing_id and self.ing.shared:
            raise ValidationError(
                {"ing": "A dish's primary ingredient cannot be a shared/misc ingredient."}
            )
        if self.ing_id and self.business_id and self.ing.business_id != self.business_id:
            raise ValidationError({"ing": "Ingredient belongs to another business."})

    @property
    def has_recipe(self) -> bool:
        return self.recipe_lines.exists()


class RecipeLine(TimeStampedModel):
    """One ingredient quantity per portion of a dish. A dish with ≥1 line is a *recipe dish* (§5b).

    Not tenant-scoped directly: the dish carries the tenant, and a second FK would be a second thing to
    keep in sync. `business` is reachable as `line.dish.business`.
    """

    dish = models.ForeignKey(Dish, on_delete=models.CASCADE, related_name="recipe_lines")
    ingredient = models.ForeignKey(
        Ingredient, on_delete=models.PROTECT, related_name="recipe_lines"
    )
    #: In the ingredient's `recipe_unit` (grams, usually).
    qty_per_portion = models.DecimalField(
        max_digits=12, decimal_places=3, validators=[MinValueValidator(Decimal("0"))]
    )
    source_template = models.ForeignKey(
        "recipes.RecipeTemplate",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="adopted_lines",
    )
    confidence = models.CharField(
        max_length=14, choices=Confidence.choices, default=Confidence.TYPICAL
    )

    class Meta:
        ordering = ("dish", "ingredient")
        constraints = [
            models.UniqueConstraint(fields=["dish", "ingredient"], name="unique_recipe_line")
        ]

    def __str__(self) -> str:
        return f"{self.dish.name}: {self.qty_per_portion}{self.ingredient.recipe_unit} {self.ingredient.name}"

    def clean(self):
        if self.ingredient_id and self.ingredient.shared:
            raise ValidationError(
                {
                    "ingredient": "Shared ingredients (oil, masalas, packaging) are pooled, not "
                    "given recipe lines — see §5b."
                }
            )
        if (
            self.dish_id
            and self.ingredient_id
            and self.dish.business_id != self.ingredient.business_id
        ):
            raise ValidationError({"ingredient": "Ingredient belongs to another business."})


class DailyStock(TenantScopedModel):
    """Opening and closing count for one ingredient on one day.

    One row per (business, ingredient, date). Opening and closing are captured separately, each once per
    day by a non-Owner; a second attempt raises (§3). Corrections go through the Owner entry endpoint.
    """

    date = models.DateField(db_index=True)
    ingredient = models.ForeignKey(Ingredient, on_delete=models.CASCADE, related_name="stocks")

    opening_qty = quantity_field(null=True, blank=True)
    opened_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_openings",
    )
    opened_at = models.DateTimeField(null=True, blank=True)

    closing_qty = quantity_field(null=True, blank=True)
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_closings",
    )
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-date", "ingredient__name")
        verbose_name_plural = "daily stocks"
        constraints = [
            models.UniqueConstraint(
                fields=["business", "ingredient", "date"], name="unique_daily_stock"
            )
        ]
        indexes = [models.Index(fields=["business", "date"])]

    def __str__(self) -> str:
        return f"{self.date} {self.ingredient.name}"


class Purchase(TenantScopedModel):
    """ "Receive goods" — ordering and receiving in one step, as the restaurant actually does it."""

    date = models.DateField(db_index=True)
    vendor = models.ForeignKey(Vendor, on_delete=models.PROTECT, related_name="purchases")
    ingredient = models.ForeignKey(Ingredient, on_delete=models.PROTECT, related_name="purchases")
    qty_invoiced = quantity_field()
    rate = money_field()
    #: Always qty_invoiced × rate — what the vendor billed, regardless of what arrived.
    amount = money_field(default=Decimal("0"))
    invoice_ref = models.CharField(max_length=60, blank=True)
    invoice_image = models.ImageField(upload_to="invoices/%Y/%m/", null=True, blank=True)
    #: What was actually counted in. Less than invoiced ⇒ short-delivery alert.
    qty_received = quantity_field()
    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="purchases"
    )
    received_at = models.DateTimeField(null=True, blank=True)
    request = models.ForeignKey(
        "inventory.Request",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="purchases",
    )

    class Meta:
        ordering = ("-date", "-id")
        indexes = [models.Index(fields=["business", "date"])]

    def __str__(self) -> str:
        return f"{self.date} {self.ingredient.name} x{self.qty_received}"

    def save(self, *args, **kwargs):
        self.amount = (self.qty_invoiced or Decimal("0")) * (self.rate or Decimal("0"))
        super().save(*args, **kwargs)

    @property
    def is_short(self) -> bool:
        return self.qty_received < self.qty_invoiced


class WastageReason(models.TextChoices):
    SPOILAGE = "spoilage", "Spoilage"
    TRIM = "trim", "Trim/prep loss"
    STAFF_MEAL = "staff_meal", "Staff meal"
    SPILL = "spill", "Spill/damage"
    RETURNED = "returned", "Returned/rejected"
    OTHER = "other", "Other"


class Wastage(TenantScopedModel):
    date = models.DateField(db_index=True)
    ingredient = models.ForeignKey(Ingredient, on_delete=models.PROTECT, related_name="wastages")
    qty = quantity_field()
    reason = models.CharField(max_length=12, choices=WastageReason.choices)
    #: Required when reason is "other" — otherwise the by-reason breakdown degenerates to one bucket.
    note = models.CharField(max_length=200, blank=True)
    entered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="wastages"
    )
    entered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-date", "-id")
        verbose_name_plural = "wastages"
        indexes = [models.Index(fields=["business", "date"])]

    def __str__(self) -> str:
        return f"{self.date} {self.ingredient.name} {self.qty}"

    def clean(self):
        if self.reason == WastageReason.OTHER and not self.note.strip():
            raise ValidationError({"note": "A note is required when the reason is Other."})


class SaleSource(models.TextChoices):
    MANUAL = "manual", "Manual"
    IMPORT = "import", "POS import"


class Sale(TenantScopedModel):
    date = models.DateField(db_index=True)
    dish = models.ForeignKey(Dish, on_delete=models.PROTECT, related_name="sales")
    plates = models.PositiveIntegerField()
    #: Defaults to dish.price × plates; editable so a discount or a comp can be recorded honestly.
    revenue = money_field()
    entered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="sales"
    )
    entered_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(max_length=8, choices=SaleSource.choices, default=SaleSource.MANUAL)
    #: Dine-in, takeaway, Swiggy, Zomato… Carried so reports can split channels later; nothing
    #: branches on it yet. Blank for manual entry.
    channel = models.CharField(max_length=40, blank=True)
    import_batch = models.ForeignKey(
        "inventory.SalesImport",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sales",
    )

    class Meta:
        ordering = ("-date", "dish__name")
        constraints = [
            # One figure per dish per day. Without this, a re-entry doubles the day's revenue and every
            # cost% silently halves.
            models.UniqueConstraint(fields=["business", "dish", "date"], name="unique_sale_per_day")
        ]
        indexes = [models.Index(fields=["business", "date"])]

    def __str__(self) -> str:
        return f"{self.date} {self.dish.name} x{self.plates}"


class RequestStatus(models.TextChoices):
    OPEN = "open", "Open"
    FULFILLED = "fulfilled", "Fulfilled"


class Request(TenantScopedModel):
    """Head Chef asks for stock; Manager/Owner buys it. Auto-closed when a purchase references it."""

    date = models.DateField(db_index=True)
    ingredient = models.ForeignKey(Ingredient, on_delete=models.CASCADE, related_name="requests")
    qty = quantity_field()
    note = models.CharField(max_length=200, blank=True)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="requests"
    )
    status = models.CharField(
        max_length=10, choices=RequestStatus.choices, default=RequestStatus.OPEN, db_index=True
    )
    fulfilled_purchase = models.ForeignKey(
        Purchase,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="fulfilled_requests",
    )

    class Meta:
        ordering = ("-date", "-id")
        indexes = [models.Index(fields=["business", "status"])]

    def __str__(self) -> str:
        return f"{self.date} {self.ingredient.name} {self.qty} ({self.status})"


class DishAlias(TenantScopedModel):
    """A POS item name mapped to a dish, with an optional portion multiplier.

    `Dish.pos_alias` holds one name; this holds the rest, and adds `plate_multiplier` so a menu that
    sells "Chilli Chicken (Half)" as a separate POS item can count as half a plate of the full dish
    rather than needing a duplicate dish with its own recipe.
    """

    dish = models.ForeignKey(Dish, on_delete=models.CASCADE, related_name="aliases")
    #: Exactly as the POS spells it, for display.
    pos_name = models.CharField(max_length=160)
    #: Case/space/punctuation-insensitive key actually used for matching.
    normalised = models.CharField(max_length=160, db_index=True)
    plate_multiplier = models.DecimalField(
        max_digits=6,
        decimal_places=3,
        default=Decimal("1"),
        validators=[MinValueValidator(Decimal("0.001"))],
    )

    class Meta:
        verbose_name_plural = "dish aliases"
        ordering = ("pos_name",)
        constraints = [
            models.UniqueConstraint(
                fields=["business", "normalised"], name="unique_alias_per_business"
            )
        ]

    def __str__(self) -> str:
        suffix = f" x{self.plate_multiplier}" if self.plate_multiplier != Decimal("1") else ""
        return f"{self.pos_name} -> {self.dish.name}{suffix}"

    def save(self, *args, **kwargs):
        from imports.parsers.base import normalise_item

        self.normalised = normalise_item(self.pos_name)
        super().save(*args, **kwargs)


class SalesImport(TenantScopedModel):
    """One uploaded POS report (§5c)."""

    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="sales_imports"
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)
    filename = models.CharField(max_length=200)
    #: Which parser read it, so a later discrepancy can be traced to a format rather than a user.
    format_key = models.CharField(max_length=40, blank=True)
    #: sha256 of (file bytes + format + range). Confirming the same preview twice must not
    #: double-count, and a restaurant on bad wifi will press the button twice.
    file_hash = models.CharField(max_length=64, blank=True, db_index=True)
    date_from = models.DateField()
    date_to = models.DateField()
    rows_total = models.PositiveIntegerField(default=0)
    rows_matched = models.PositiveIntegerField(default=0)
    rows_unmatched = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ("-uploaded_at",)

    def __str__(self) -> str:
        return f"{self.filename} ({self.date_from}–{self.date_to})"
