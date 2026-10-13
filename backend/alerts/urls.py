from django.urls import path

from .views import AlertCheckView, AlertListView

urlpatterns = [
    path(
        "businesses/<int:business_id>/alerts/check/",
        AlertCheckView.as_view(),
        name="alert-check",
    ),
    path(
        "businesses/<int:business_id>/alerts/",
        AlertListView.as_view(),
        name="alert-list",
    ),
]
