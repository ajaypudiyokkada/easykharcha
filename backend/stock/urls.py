from django.urls import path

from .views import (
    SellItemBulkCreateView,
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
        "businesses/<int:business_id>/sell-items/",
        SellItemListView.as_view(),
        name="sell-item-list",
    ),
    path(
        "businesses/<int:business_id>/sell-items/bulk/",
        SellItemBulkCreateView.as_view(),
        name="sell-item-bulk-create",
    ),
]
