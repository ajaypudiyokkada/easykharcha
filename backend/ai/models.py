from django.conf import settings
from django.db import models

from businesses.models import Business


class MenuScanStatus(models.TextChoices):
    QUEUED = "queued", "queued"
    READING = "reading", "reading"
    DONE = "done", "done"
    FAILED = "failed", "failed"


class MenuScan(models.Model):
    """One uploaded menu (1-6 images or one PDF), read by the AI worker (ai/jobs.py). The files
    themselves never live here or anywhere durable — see ai/files.py — only the result JSON does."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="menu_scans")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="menu_scans_created"
    )
    status = models.CharField(
        max_length=10, choices=MenuScanStatus.choices, default=MenuScanStatus.QUEUED
    )
    page_count = models.PositiveSmallIntegerField(default=1)
    # Sub-folder name under settings.AI_TEMP_ROOT holding the uploaded file(s) until the job finishes
    # or fails, then deleted (ai/files.py) — never a durable path, never served to a browser.
    temp_dir = models.CharField(max_length=64)
    result = models.JSONField(null=True, blank=True)
    error_code = models.CharField(max_length=40, blank=True, default="")
    model_used = models.CharField(max_length=60, blank=True, default="")
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"Menu scan {self.id} ({self.status}) for business {self.business_id}"


class AiUsageKind(models.TextChoices):
    MENU_SCAN = "menu_scan", "menu_scan"
    RECIPE_SUGGESTION = "recipe_suggestion", "recipe_suggestion"
    KITCHEN_BASE_DISCOVERY = "kitchen_base_discovery", "kitchen_base_discovery"


class AiUsage(models.Model):
    """One row per real AI call (never a cache hit) — the basis for both AI_MONTHLY_CAP_USD and any
    future per-business cost reporting. est_cost_usd is computed once at write time from that day's
    AI_PRICE_IN_PER_MTOK/AI_PRICE_OUT_PER_MTOK, so it stays correct even if those prices change later."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="ai_usage")
    kind = models.CharField(max_length=24, choices=AiUsageKind.choices)
    model = models.CharField(max_length=60)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    est_cost_usd = models.DecimalField(max_digits=10, decimal_places=4, default=0)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created",)

    def __str__(self) -> str:
        return f"{self.kind} ({self.model}) for business {self.business_id}"


class AiRecipeCache(models.Model):
    """Shared across every business — keyed by normalised dish name + business_type + prompt_version,
    so a hit costs nothing and skips the API entirely. Stores ONLY the generic suggestion (ingredient
    names, grams, portion label): never a business's own prices, ids, or any other business-specific
    data. prompt_version (ai/prompts.py's RECIPE_PROMPT_VERSION) is bumped whenever the recipe prompt
    or schema shape changes meaningfully, so a stale cache row from an old prompt is never served —
    it just becomes an unreachable row rather than needing a data migration to clear it out."""

    dish_name_normalised = models.CharField(max_length=80)
    business_type = models.CharField(max_length=32)
    prompt_version = models.PositiveSmallIntegerField(default=1)
    result = models.JSONField()
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["dish_name_normalised", "business_type", "prompt_version"],
                name="unique_ai_recipe_cache_key",
            )
        ]

    def __str__(self) -> str:
        return f"{self.dish_name_normalised} ({self.business_type})"


class AiKitchenBaseCache(models.Model):
    """Step EK-1: caches a base-discovery result by (sector, the menu's own normalised dish-name set,
    prompt_version) — unlike AiRecipeCache, this is per-menu (a specific set of dishes), not
    per-dish, since which bases a menu needs depends on the whole dish list together. Stores only the
    generic suggestion (base formulas/used-by), never a business id."""

    sector = models.CharField(max_length=32)
    dish_set_hash = models.CharField(max_length=64)
    prompt_version = models.PositiveSmallIntegerField(default=1)
    result = models.JSONField()
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["sector", "dish_set_hash", "prompt_version"],
                name="unique_ai_kitchen_base_cache_key",
            )
        ]

    def __str__(self) -> str:
        return f"{self.sector} bases ({self.dish_set_hash[:8]})"
