from django.urls import path

from .views import (
    CountDetailView,
    CountFormView,
    CountListCreateView,
    CountRemindView,
    CountsTodayStatusView,
    TodayView,
)

urlpatterns = [
    path(
        "businesses/<int:business_id>/counts/form/",
        CountFormView.as_view(),
        name="count-form",
    ),
    path(
        "businesses/<int:business_id>/counts/today/",
        CountsTodayStatusView.as_view(),
        name="count-today-status",
    ),
    path(
        "businesses/<int:business_id>/counts/remind/",
        CountRemindView.as_view(),
        name="count-remind",
    ),
    path(
        "businesses/<int:business_id>/counts/<int:count_id>/",
        CountDetailView.as_view(),
        name="count-detail",
    ),
    path(
        "businesses/<int:business_id>/counts/",
        CountListCreateView.as_view(),
        name="count-list",
    ),
    path("businesses/<int:business_id>/today/", TodayView.as_view(), name="today"),
]
