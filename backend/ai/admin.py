from django.contrib import admin

from config.admin_mixins import ReadOnlyAdminMixin

from .models import AiUsage


@admin.register(AiUsage)
class AiUsageAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
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
