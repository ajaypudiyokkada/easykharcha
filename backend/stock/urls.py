from django.urls import path

from .views import (
    BaseDetailView,
    BaseListView,
    BaseUsedInView,
    LowStockListView,
    SellItemBulkCreateView,
    SellItemDetailView,
    SellItemListView,
    StockItemBulkCreateView,
    StockItemDetailView,
    StockItemListView,
)

urlpatterns = [
    path(
        "businesses/<int:business_id>/stock-items/",
        StockItemListView.as_view(),
        name="stock-item-list",
    ),
    path(
        "businesses/<int:business_id>/stock-items/bulk/",
        StockItemBulkCreateView.as_view(),
        name="stock-item-bulk-create",
    ),
    path(
        "businesses/<int:business_id>/stock-items/<int:item_id>/",
        StockItemDetailView.as_view(),
        name="stock-item-detail",
    ),
    path(
        "businesses/<int:business_id>/stock/low-stock/",
        LowStockListView.as_view(),
        name="low-stock-list",
    ),
    path(
        "businesses/<int:business_id>/sell-items/",
        SellItemListView.as_view(),
        name="sell-item-list",
    ),
    path(
        "businesses/<int:business_id>/sell-items/bulk/",
        SellItemBulkCreateView.as_view(),
        name="sell-item-bulk-create",
    ),
    path("businesses/<int:business_id>/bases/", BaseListView.as_view(), name="base-list"),
    path(
        "businesses/<int:business_id>/bases/<int:base_id>/",
        BaseDetailView.as_view(),
        name="base-detail",
    ),
    path(
        "businesses/<int:business_id>/bases/<int:base_id>/used-in/",
        BaseUsedInView.as_view(),
        name="base-used-in",
    ),
    path(
        "businesses/<int:business_id>/sell-items/<int:item_id>/",
        SellItemDetailView.as_view(),
        name="sell-item-detail",
    ),
]
