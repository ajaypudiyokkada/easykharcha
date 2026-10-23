from django.contrib import admin

from config.admin_mixins import ReadOnlyAdminMixin, SuperuserOnlyAdminMixin

from .models import AiUsage, MenuScan


@admin.register(AiUsage)
class AiUsageAdmin(SuperuserOnlyAdminMixin, ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = (
        "business",
        "kind",
        "model",
        "input_tokens",
        "output_tokens",
        "est_cost_usd",
        "created",
    )
    list_filter = ("kind", "model", "created")
    search_fields = ("business__name",)


@admin.register(MenuScan)
class MenuScanAdmin(SuperuserOnlyAdminMixin, ReadOnlyAdminMixin, admin.ModelAdmin):
    """Step C2c: visibility into stuck/failed scans — superuser-only, same as AiUsage, since scan
    rows (indirectly) point at a business's menu content."""

    list_display = (
        "id",
        "business",
        "status",
        "created_at",
        "finished_at",
        "error_code",
        "page_count",
    )
    list_filter = ("status",)
    search_fields = ("business__name", "id")
