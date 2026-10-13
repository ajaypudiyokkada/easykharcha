from django.urls import path

from .views import SaleDetailView, SaleListCreateView

urlpatterns = [
    path("businesses/<int:business_id>/sales/", SaleListCreateView.as_view(), name="sale-list"),
    path(
        "businesses/<int:business_id>/sales/<int:sid>/",
        SaleDetailView.as_view(),
        name="sale-detail",
    ),
]
