from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models

hex_colour_validator = RegexValidator(
    r"^#[0-9A-Fa-f]{6}$", "Enter a 6-digit hex colour, e.g. #1F6F63."
)


class BusinessType(models.TextChoices):
    RESTAURANT_CAFE = "restaurant_cafe", "Restaurant or cafe"
    CLOUD_KITCHEN = "cloud_kitchen", "Cloud kitchen"
    BAKERY_SWEETS = "bakery_sweets", "Bakery or sweets"
    TIFFIN_CATERING = "tiffin_catering", "Tiffin or catering"
    HOMESTAY = "homestay", "Homestay"
    SMALL_MANUFACTURING = "small_manufacturing", "Small manufacturing"
    HOME_BUSINESS = "home_business", "Home business"
    PACK_REPACK_SHOP = "pack_repack_shop", "Shop that packs or repacks"
    OTHER = "other", "Other"


class Business(models.Model):
    name = models.CharField(max_length=120)
    business_type = models.CharField(max_length=32, choices=BusinessType.choices)
    city = models.CharField(max_length=120)
    tagline = models.CharField(max_length=160, blank=True)
    primary_colour = models.CharField(
        max_length=7, default="#1F6F63", validators=[hex_colour_validator]
    )
    logo = models.ImageField(upload_to="business_logos/", blank=True, null=True)
    timezone = models.CharField(max_length=64, default="Asia/Kolkata")
    currency = models.CharField(max_length=8, default="INR")
    onboarding_step = models.PositiveSmallIntegerField(default=1)
    onboarding_completed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="businesses_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at",)

    def __str__(self) -> str:
        return self.name


class AccessRole(models.TextChoices):
    OWNER = "owner", "Owner"


class Access(models.Model):
    """A user's role on a business. Looked up fresh on every request — never cached in a token, so
    a role change (or removal) takes effect on the very next request."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="business_access"
    )
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="access")
    role = models.CharField(max_length=20, choices=AccessRole.choices, default=AccessRole.OWNER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "business"], name="unique_user_business_access")
        ]

    def __str__(self) -> str:
        return f"{self.user_id} as {self.role} on {self.business_id}"
