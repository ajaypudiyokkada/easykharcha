from django.urls import path

from .views import PurchaseDetailView, PurchaseListCreateView, SupplierListView

urlpatterns = [
    path(
        "businesses/<int:business_id>/purchases/",
        PurchaseListCreateView.as_view(),
        name="purchase-list",
    ),
    path(
        "businesses/<int:business_id>/purchases/<int:pid>/",
        PurchaseDetailView.as_view(),
        name="purchase-detail",
    ),
    path(
        "businesses/<int:business_id>/suppliers/",
        SupplierListView.as_view(),
        name="supplier-list",
    ),
]
