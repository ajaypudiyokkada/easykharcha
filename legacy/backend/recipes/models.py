from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models

from core.models import TimeStampedModel
from inventory.models import Confidence, RecipeUnit


class CanonicalIngredient(TimeStampedModel):
    """A global ingredient tag, e.g. CHICKEN_BONELESS.

    This is what makes one global template usable by every tenant: FOMO's "Chicken curry cut" and another
    restaurant's "Curry cut chicken" both point at `CHICKEN_CURRY_CUT`, so a template line written once
    maps to both. Managed by Super Admins; tenants only choose from the list.
    """

    code = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=120)
    category = models.CharField(max_length=60, blank=True)
    default_unit = models.CharField(
        max_length=3, choices=RecipeUnit.choices, default=RecipeUnit.GRAM
    )
    #: Fallback when a tenant has not measured its own cuts. Tenants override per Ingredient.
    avg_piece_weight_g = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return f"{self.name} [{self.code}]"


class TemplateBasis(models.TextChoices):
    WEIGHT = "weight", "Weight"
    PIECE = "piece", "Piece count"


class RecipeTemplate(TimeStampedModel):
    """Global starter recipe. Tenants *copy* from it; later edits here never alter copied recipes."""

    code = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=120)
    cuisine = models.CharField(max_length=60, blank=True)
    category = models.CharField(max_length=60, blank=True)
    portion_label = models.CharField(
        max_length=60, blank=True, help_text="e.g. '6 pcs', 'full plate'"
    )
    pieces_per_portion = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class RecipeTemplateLine(TimeStampedModel):
    template = models.ForeignKey(RecipeTemplate, on_delete=models.CASCADE, related_name="lines")
    canonical = models.ForeignKey(
        CanonicalIngredient, on_delete=models.PROTECT, related_name="template_lines"
    )
    qty_per_portion = models.DecimalField(
        max_digits=12, decimal_places=3, validators=[MinValueValidator(Decimal("0"))]
    )
    unit = models.CharField(max_length=3, choices=RecipeUnit.choices, default=RecipeUnit.GRAM)
    basis = models.CharField(
        max_length=6, choices=TemplateBasis.choices, default=TemplateBasis.WEIGHT
    )
    #: {"half": 0.6, "full": 1.0, "family": 2.0} — a half plate is one dish with a multiplier, not a
    #: duplicate menu item.
    size_multipliers = models.JSONField(default=dict, blank=True)
    confidence = models.CharField(
        max_length=14, choices=Confidence.choices, default=Confidence.TYPICAL
    )

    class Meta:
        ordering = ("template", "canonical__name")
        constraints = [
            models.UniqueConstraint(fields=["template", "canonical"], name="unique_template_line")
        ]

    def __str__(self) -> str:
        return f"{self.template.code}: {self.qty_per_portion}{self.unit} {self.canonical.code}"

    def multiplier_for(self, size: str | None) -> Decimal:
        if not size:
            return Decimal("1")
        raw = (self.size_multipliers or {}).get(size)
        return Decimal(str(raw)) if raw is not None else Decimal("1")
