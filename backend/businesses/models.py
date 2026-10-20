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
    # The Owner dismissed /home's "Finish setting up" card — recorded here, not on the device, so it
    # stays dismissed on another phone or after a reinstall too.
    checklist_dismissed_at = models.DateTimeField(null=True, blank=True)
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
    MANAGER = "manager", "Manager"
    HEAD_CHEF = "head_chef", "Head chef"
    HELPER = "helper", "Helper"


TEAM_ROLES = frozenset({AccessRole.MANAGER, AccessRole.HEAD_CHEF, AccessRole.HELPER})
PIN_ROLES = frozenset({AccessRole.HEAD_CHEF, AccessRole.HELPER})


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


ONBOARDING_STEPS = range(1, 7)
SKIPPABLE_ONBOARDING_STEPS = frozenset(range(3, 7))


class OnboardingStepStatus(models.TextChoices):
    TODO = "todo", "To do"
    DONE = "done", "Done"
    SKIPPED = "skipped", "Skipped"


class OnboardingProgress(models.Model):
    """One row per wizard step (1-6) per business — created up front when the business is, so a
    status is always available for every step without special-casing "not started yet"."""

    business = models.ForeignKey(
        Business, on_delete=models.CASCADE, related_name="onboarding_progress"
    )
    step = models.PositiveSmallIntegerField()
    status = models.CharField(
        max_length=10, choices=OnboardingStepStatus.choices, default=OnboardingStepStatus.TODO
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("step",)
        constraints = [
            models.UniqueConstraint(fields=["business", "step"], name="unique_business_step")
        ]

    def __str__(self) -> str:
        return f"{self.business_id} step {self.step}: {self.status}"


class BusinessSettings(models.Model):
    """One row per business, created alongside it. Defaults and valid ranges live in
    settings.BUSINESS_SETTINGS_DEFAULTS / BUSINESS_SETTINGS_RANGES, not hardcoded here, so the
    report and the validation share one source of truth."""

    business = models.OneToOneField(Business, on_delete=models.CASCADE, related_name="settings")
    # How late in the day (hour, 0-23) the opening stock count can still be logged.
    count_deadline_hour = models.PositiveSmallIntegerField()
    # Same, for the closing stock count (default 20, meaning 8 PM).
    closing_count_hour = models.PositiveSmallIntegerField()
    target_cost_pct = models.DecimalField(max_digits=5, decimal_places=2)
    wastage_alert_pct = models.DecimalField(max_digits=5, decimal_places=2)
    rate_creep_pct = models.DecimalField(max_digits=5, decimal_places=2)
    # Step 14: how far used_since_last_count may diverge from sales-expected usage (as a % of
    # expected_used) before a stock gap line is flagged in count review.
    gap_alert_pct = models.DecimalField(max_digits=5, decimal_places=2)
    # Step 18: how many days ahead of an estimated expiry date alerts/service.py's expiry_soon alert
    # starts warning (0 days or past = danger instead).
    expiry_warn_days = models.PositiveSmallIntegerField()

    def __str__(self) -> str:
        return f"Settings for {self.business_id}"
