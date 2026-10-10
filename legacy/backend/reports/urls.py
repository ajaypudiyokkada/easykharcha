from django.urls import path

from reports.views import AlertsView, ReportView, TrendsView, VarianceView

urlpatterns = [
    path("tenants/<int:tenant_id>/report", ReportView.as_view(), name="report"),
    path("tenants/<int:tenant_id>/variance", VarianceView.as_view(), name="variance"),
    path("tenants/<int:tenant_id>/trends", TrendsView.as_view(), name="trends"),
    path("tenants/<int:tenant_id>/alerts", AlertsView.as_view(), name="alerts"),
]
