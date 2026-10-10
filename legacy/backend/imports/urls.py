from django.urls import path

from imports.views import (
    SalesImportConfirmView,
    SalesImportFormatsView,
    SalesImportPreviewView,
)

urlpatterns = [
    path(
        "tenants/<int:tenant_id>/sales/import/formats",
        SalesImportFormatsView.as_view(),
        name="sales-import-formats",
    ),
    path(
        "tenants/<int:tenant_id>/sales/import/preview",
        SalesImportPreviewView.as_view(),
        name="sales-import-preview",
    ),
    path(
        "tenants/<int:tenant_id>/sales/import/confirm",
        SalesImportConfirmView.as_view(),
        name="sales-import-confirm",
    ),
]
