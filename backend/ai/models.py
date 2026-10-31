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


class EkSetupRunStatus(models.TextChoices):
    QUEUED = "queued", "queued"
    RUNNING = "running", "running"
    DONE = "done", "done"
    FAILED = "failed", "failed"


class EkSetupRun(models.Model):
    """Step EK-4a: one "EK setup" job per MenuScan, running after the owner has reviewed and saved
    their dishes — base discovery + recipe_composer.suggest_setup over the business's own current
    (confirmed, edited, un-deleted) sell items, picked up by the same worker as MenuScan. A
    OneToOne on menu_scan enforces "one run per scan": a second POST just returns the existing run,
    never a second AI call. `result` holds the owner-facing shape (ek_setup.build_owner_result),
    never the raw suggest_setup payload — see that function's docstring for why."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="ek_setup_runs")
    menu_scan = models.OneToOneField(
        MenuScan, on_delete=models.CASCADE, related_name="ek_setup_run"
    )
    status = models.CharField(
        max_length=10, choices=EkSetupRunStatus.choices, default=EkSetupRunStatus.QUEUED
    )
    started_at = models.DateTimeField(null=True, blank=True)
    # Updated when the job starts and finishes — the stuck-job sweep (same 10-minute window as
    # MenuScan's started_at check) compares against this, not started_at, so a future step could add
    # mid-job heartbeats without changing the recovery logic.
    heartbeat = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    error = models.CharField(max_length=40, blank=True, default="")
    # Step EK-4a2: the last failure's own detail (stage, exception class/message, HTTP status) for
    # diagnosing an "ai_provider_error"/"worker_error" code after the fact — internal only, never
    # returned to the owner (see views._ek_setup_payload), never the API key or prompt/response text.
    error_detail = models.TextField(blank=True, default="")
    result = models.JSONField(null=True, blank=True)
    # Cost fields, same shape as AiUsage — suggest_setup's own cost_summary totalled across every
    # real call it made (classification, best-sellers, family recipes, ingredient merge); the
    # individual AiUsage rows are still written by recipe_composer.py/base_discovery.py as normal.
    call_count = models.PositiveSmallIntegerField(default=0)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    est_cost_usd = models.DecimalField(max_digits=10, decimal_places=4, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    # Step EK-4b: set once the Owner's confirmed setup screens have been applied (ai/ek_apply.py) —
    # null until then. A second apply only ever updates its own still-unconfirmed rows (see
    # StockItem/Base/SellItem.ek_key), so these two fields always reflect the first apply.
    applied_at = models.DateTimeField(null=True, blank=True)
    applied_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    def __str__(self) -> str:
        return f"EK setup run {self.id} ({self.status}) for business {self.business_id}"


class AiUsageKind(models.TextChoices):
    MENU_SCAN = "menu_scan", "menu_scan"
    RECIPE_SUGGESTION = "recipe_suggestion", "recipe_suggestion"
    KITCHEN_BASE_DISCOVERY = "kitchen_base_discovery", "kitchen_base_discovery"
    # Step EK-3: recipe_composer.py's best-seller pick (one call/menu) and per-family recipe calls.
    SETUP_BEST_SELLERS = "setup_best_sellers", "setup_best_sellers"
    SETUP_FAMILY_RECIPE = "setup_family_recipe", "setup_family_recipe"
    # Step EK-3c: the one ingredient merge + low-stock category call in resolve_ingredients.
    SETUP_INGREDIENT_MERGE = "setup_ingredient_merge", "setup_ingredient_merge"


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
    """Step EK-1/EK-2: caches the final, deterministically-mapped bases result for a menu by
    (sector, the menu's own normalised dish-name set, prompt_version) — unlike AiRecipeCache or
    AiDishTypeCache below, this is per-menu (a specific set of dishes), not per-dish, since which
    bases actually clear the 3-dish rule depends on the whole dish list together. Stores only the
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


class AiDishTypeCache(models.Model):
    """Step EK-2: caches classify_dishes's per-dish result by (dish_name_normalised, sector,
    prompt_version) — a dish's kitchen-prep type doesn't depend on what else is on the menu (unlike
    AiKitchenBaseCache above), so this is reusable across every menu/business in the same sector,
    same shape as AiRecipeCache. Stores only the generic classification, never a business id."""

    dish_name_normalised = models.CharField(max_length=80)
    sector = models.CharField(max_length=32)
    prompt_version = models.PositiveSmallIntegerField(default=1)
    result = models.JSONField()
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["dish_name_normalised", "sector", "prompt_version"],
                name="unique_ai_dish_type_cache_key",
            )
        ]

    def __str__(self) -> str:
        return f"{self.dish_name_normalised} ({self.sector})"


class AiFamilyRecipeCache(models.Model):
    """Step EK-3: caches recipe_composer.compose_family_recipes's per-family result by (sector,
    family_hash — a hash of the normalised family name + its member dishes' normalised names,
    prompt_version) — a family's recipe shape doesn't depend on which business asked for it, same
    per-dish-set-but-generic spirit as AiKitchenBaseCache. Stores only the generic suggestion
    (ingredient names/quantities), never a business id."""

    sector = models.CharField(max_length=32)
    family_hash = models.CharField(max_length=64)
    prompt_version = models.PositiveSmallIntegerField(default=1)
    result = models.JSONField()
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["sector", "family_hash", "prompt_version"],
                name="unique_ai_family_recipe_cache_key",
            )
        ]

    def __str__(self) -> str:
        return f"{self.sector} family recipe ({self.family_hash[:8]})"
