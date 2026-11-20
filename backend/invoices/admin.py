from django.contrib import admin

from config.admin_mixins import ReadOnlyAdminMixin

from .models import Invoice


@admin.register(Invoice)
class InvoiceAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    """Customer bills: a ledger, never edited or deleted here (void it in the app instead)."""

    list_display = ("number", "business", "sale_date", "total", "status")
    list_filter = ("status",)
    search_fields = ("number", "business__name")
