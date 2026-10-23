from django.contrib import admin, messages
from django.db import transaction
from django.shortcuts import render

from audit.log import log_action
from counts.models import StockCount
from purchases.models import Purchase
from sales.models import Sale
from stock.models import SellItem, StockItem
from wastage.models import WastageEntry

from .models import Access, Business

ACTION_CHECKBOX_NAME = admin.helpers.ACTION_CHECKBOX_NAME


def _business_counts(business: Business) -> dict:
    return {
        "Stock items": business.stock_items.count(),
        "Sell items": business.sell_items.count(),
        "Stock counts": business.stock_counts.count(),
        "Purchases": business.purchases.count(),
        "Wastage entries": business.wastage_entries.count(),
        "Sales": business.sales.count(),
        "Team members": business.access.count(),
        "Menu scans": business.menu_scans.count(),
    }


def delete_business_and_its_data(business: Business) -> None:
    """Deletes a business and everything under it, in the order its PROTECT constraints need —
    Sale/WastageEntry/CountLine/PurchaseLine/SellItemIngredient all protect StockItem or SellItem, so
    the rows that protect them are removed first; everything else (Access, OnboardingProgress,
    BusinessSettings, AlertCheck, MenuScan, AiUsage) cascades from Business itself. See docs/MAP.md's
    admin section for the full FK map this order is based on."""
    Sale.objects.filter(business=business).delete()
    WastageEntry.objects.filter(business=business).delete()
    StockCount.objects.filter(business=business).delete()
    Purchase.objects.filter(business=business).delete()
    SellItem.objects.filter(business=business).delete()
    StockItem.objects.filter(business=business).delete()
    business.delete()


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = ("name", "business_type", "city", "created_by", "created_at")
    list_filter = ("business_type",)
    search_fields = ("name", "city", "created_by__mobile", "created_by__name")
    readonly_fields = ("created_at",)
    actions = ["delete_business_and_data"]

    # The ledger/business data this cascades into stays undeletable from its own admin page — only
    # this explicit action (or deleting the owner via it) ever removes it.
    def has_delete_permission(self, request, obj=None):
        return False

    @admin.action(description="Delete business and all its data (cannot be undone)")
    def delete_business_and_data(self, request, queryset):
        if not request.user.is_superuser:
            self.message_user(request, "Only a superuser can do this.", level=messages.ERROR)
            return None

        if request.POST.get("apply"):
            deleted_count = queryset.count()
            for business in queryset:
                counts = _business_counts(business)
                name = business.name
                owner_email = business.created_by.email
                with transaction.atomic():
                    delete_business_and_its_data(business)
                    log_action(
                        user=request.user,
                        action="admin.business_delete",
                        metadata={
                            "business_name": name,
                            "owner_email": owner_email,
                            "counts": counts,
                        },
                    )
            self.message_user(
                request,
                f"Deleted {deleted_count} business(es) and all their data.",
                level=messages.SUCCESS,
            )
            return None

        businesses_data = [(business, _business_counts(business)) for business in queryset]
        return render(
            request,
            "admin/businesses/confirm_delete_business.html",
            {
                "businesses_data": businesses_data,
                "queryset": queryset,
                "opts": self.model._meta,
                "action_checkbox_name": ACTION_CHECKBOX_NAME,
                **self.admin_site.each_context(request),
            },
        )


@admin.register(Access)
class AccessAdmin(admin.ModelAdmin):
    """Memberships/roles — one row per user per business."""

    list_display = ("user", "business", "role", "created_at")
    list_filter = ("role",)
    search_fields = ("user__mobile", "user__name", "business__name")
    readonly_fields = ("created_at",)
