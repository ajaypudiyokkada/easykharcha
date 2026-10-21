from django.contrib import admin

from .models import User


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    """Support lookup only — password is excluded below so no hash is ever shown, and deleting a
    user is disabled (businesses/other data FK to User with PROTECT in most places anyway)."""

    list_display = ("mobile", "name", "email", "is_active", "is_staff", "created_at")
    list_filter = ("is_active", "is_staff", "uses_pin", "must_change_password")
    search_fields = ("mobile", "name", "email")
    ordering = ("-created_at",)
    exclude = ("password",)
    readonly_fields = (
        "created_at",
        "consent_at",
        "consent_version",
        "mobile_verified_at",
        "last_login",
    )

    def has_delete_permission(self, request, obj=None):
        return False
