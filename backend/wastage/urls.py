from django.urls import path

from .views import WastageDetailView, WastageListCreateView

urlpatterns = [
    path(
        "businesses/<int:business_id>/wastage/",
        WastageListCreateView.as_view(),
        name="wastage-list",
    ),
    path(
        "businesses/<int:business_id>/wastage/<int:entry_id>/",
        WastageDetailView.as_view(),
        name="wastage-detail",
    ),
]
