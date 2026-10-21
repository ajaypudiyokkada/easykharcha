from django.contrib import admin

from .models import Access, Business


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = ("name", "business_type", "city", "created_by", "created_at")
    list_filter = ("business_type",)
    search_fields = ("name", "city", "created_by__mobile", "created_by__name")
    readonly_fields = ("created_at",)

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Access)
class AccessAdmin(admin.ModelAdmin):
    """Memberships/roles — one row per user per business."""

    list_display = ("user", "business", "role", "created_at")
    list_filter = ("role",)
    search_fields = ("user__mobile", "user__name", "business__name")
    readonly_fields = ("created_at",)
