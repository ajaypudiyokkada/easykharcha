from django.contrib import admin

from .models import AlertCheck


@admin.register(AlertCheck)
class AlertCheckAdmin(admin.ModelAdmin):
    list_display = ("business", "alert_key", "checked_by", "checked_at")
    list_filter = ("checked_at",)
    search_fields = ("business__name", "alert_key")
    readonly_fields = ("checked_at",)
