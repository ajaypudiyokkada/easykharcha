from django.urls import path

from .views import ReportsSummaryView

urlpatterns = [
    path(
        "businesses/<int:business_id>/reports/summary/",
        ReportsSummaryView.as_view(),
        name="reports-summary",
    ),
]
