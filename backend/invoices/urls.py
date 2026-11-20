from django.urls import path

from .views import (
    InvoiceDetailView,
    InvoiceListCreateView,
    InvoiceMarkPaidView,
    InvoiceMarkUnpaidView,
    InvoiceProofView,
    InvoiceSettingsView,
    InvoiceVoidView,
    PaymentProofUploadView,
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
        "businesses/<int:business_id>/invoices/<int:iid>/mark-paid/",
        InvoiceMarkPaidView.as_view(),
        name="invoice-mark-paid",
    ),
    path(
        "businesses/<int:business_id>/invoices/<int:iid>/mark-unpaid/",
        InvoiceMarkUnpaidView.as_view(),
        name="invoice-mark-unpaid",
    ),
    path(
        "businesses/<int:business_id>/invoices/<int:iid>/payment-proof/",
        InvoiceProofView.as_view(),
        name="invoice-payment-proof",
    ),
    path(
        "businesses/<int:business_id>/payment-proofs/",
        PaymentProofUploadView.as_view(),
        name="payment-proof-upload",
    ),
    path(
        "businesses/<int:business_id>/invoice-settings/",
        InvoiceSettingsView.as_view(),
        name="invoice-settings",
    ),
]
