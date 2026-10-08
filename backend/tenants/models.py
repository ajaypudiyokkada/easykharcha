from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models

from core.fields import percent_field
from core.models import TimeStampedModel

hex_colour = RegexValidator(
    r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$", "Use a hex colour like #B19461."
)


class BusinessType(models.TextChoices):
    RESTAURANT = "restaurant", "Restaurant"
    HOMESTAY = "homestay", "Homestay"
    CLOUD_KITCHEN = "cloud_kitchen", "Cloud Kitchen"
    BAKERY = "bakery", "Bakery"
    OTHER = "other", "Other"


class BusinessStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    INACTIVE = "inactive", "Inactive"


class Weekday(models.IntegerChoices):
    MONDAY = 0, "Monday"
    TUESDAY = 1, "Tuesday"
    WEDNESDAY = 2, "Wednesday"
    THURSDAY = 3, "Thursday"
    FRIDAY = 4, "Friday"
    SATURDAY = 5, "Saturday"
    SUNDAY = 6, "Sunday"


class Business(TimeStampedModel):
    """The tenant. Named `Business` per docs/DECISIONS.md D-001.

    `business_type` drives UI labels only — no backend behaviour branches on it. A homestay and a
    restaurant run identical buy → process → sell arithmetic; only the words differ.
    """

    name = models.CharField(max_length=120)
    tagline = models.CharField(max_length=200, blank=True)
    business_type = models.CharField(
        max_length=20, choices=BusinessType.choices, default=BusinessType.RESTAURANT
    )
    logo = models.ImageField(upload_to="logos/", null=True, blank=True)
    primary_colour = models.CharField(max_length=7, default="#B19461", validators=[hex_colour])
    accent_colour = models.CharField(max_length=7, default="#8EABC1", validators=[hex_colour])
    status = models.CharField(
        max_length=10, choices=BusinessStatus.choices, default=BusinessStatus.ACTIVE
    )

    #: Target food cost as a % of revenue. Per-ingredient overrides live on Ingredient.target_pct.
    default_target_pct = percent_field(default=30)
    #: Wastage over this % of (opening + purchased) raises an alert.
    waste_alert_pct = percent_field(default=5)
    #: Purchase rate more than this % above the standard rate is "rate creep".
    rate_creep_pct = percent_field(default=10)
    #: |unexplained| over this % of expected raises a variance alert — only at 100% recipe coverage.
    variance_alert_pct = percent_field(default=10)
    #: Hours after local midnight by which yesterday's closing stock must be in. Opening uses half.
    sla_hours = models.PositiveSmallIntegerField(
        default=12, validators=[MinValueValidator(1), MaxValueValidator(48)]
    )
    #: Weekday of the full physical count. Reporting convenience; nothing is enforced on it yet.
    count_day = models.PositiveSmallIntegerField(choices=Weekday.choices, default=Weekday.MONDAY)

    class Meta:
        verbose_name_plural = "businesses"
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name

    @property
    def dish_label(self) -> str:
        """UI word for Dish — "Menu item" reads wrong for a homestay, "Dish" reads wrong for a bakery."""
        return {
            BusinessType.RESTAURANT: "Dish",
            BusinessType.CLOUD_KITCHEN: "Dish",
            BusinessType.BAKERY: "Product",
            BusinessType.HOMESTAY: "Service",
        }.get(self.business_type, "Menu item")
