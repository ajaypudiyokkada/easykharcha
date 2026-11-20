from django.contrib import admin

from config.admin_mixins import ReadOnlyAdminMixin

from .models import Invoice, StoredImage


@admin.register(Invoice)
class InvoiceAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    """Customer bills: a ledger, never edited or deleted here (void it in the app instead)."""

    list_display = ("number", "business", "sale_date", "total", "status")
    list_filter = ("status",)
    search_fields = ("number", "business__name")


@admin.register(StoredImage)
class StoredImageAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    """Metadata only: the files are private and are never shown or served from the admin."""

    list_display = ("id", "business", "kind", "size", "uploaded_at", "attached", "removed_at")
    list_filter = ("kind", "attached")
