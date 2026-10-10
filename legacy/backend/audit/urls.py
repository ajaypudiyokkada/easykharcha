from django.urls import path

from audit.views import AuditView

urlpatterns = [
    path("tenants/<int:tenant_id>/audit", AuditView.as_view(), name="audit"),
]
