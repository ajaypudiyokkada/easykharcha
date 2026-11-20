from django.urls import path

from .views import (
    InvoiceDetailView,
    InvoiceListCreateView,
    InvoiceSettingsView,
    InvoiceVoidView,
)

urlpatterns = [
    path(
        "businesses/<int:business_id>/invoices/",
        InvoiceListCreateView.as_view(),
        name="invoice-list",
    ),
    path(
        "businesses/<int:business_id>/invoices/<int:iid>/",
        InvoiceDetailView.as_view(),
        name="invoice-detail",
    ),
    path(
        "businesses/<int:business_id>/invoices/<int:iid>/void/",
        InvoiceVoidView.as_view(),
        name="invoice-void",
    ),
    path(
        "businesses/<int:business_id>/invoice-settings/",
        InvoiceSettingsView.as_view(),
        name="invoice-settings",
    ),
]
