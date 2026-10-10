from django.urls import path

from tenants.views import (
    MyTenantsView,
    TenantAccessDetailView,
    TenantAccessView,
    TenantBootstrapView,
    TenantCreateView,
    TenantSettingsView,
)

urlpatterns = [
    path("tenants/mine", MyTenantsView.as_view(), name="tenants-mine"),
    path("tenants", TenantCreateView.as_view(), name="tenant-create"),
    path(
        "tenants/<int:tenant_id>/bootstrap", TenantBootstrapView.as_view(), name="tenant-bootstrap"
    ),
    path("tenants/<int:tenant_id>/settings", TenantSettingsView.as_view(), name="tenant-settings"),
    path("tenants/<int:tenant_id>/access", TenantAccessView.as_view(), name="tenant-access"),
    path(
        "tenants/<int:tenant_id>/access/<int:pk>",
        TenantAccessDetailView.as_view(),
        name="tenant-access-detail",
    ),
]
