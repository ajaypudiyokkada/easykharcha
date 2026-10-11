from django.urls import path

from .views import BusinessCreateView, BusinessLogoView, BusinessUpdateView

urlpatterns = [
    path("businesses/", BusinessCreateView.as_view(), name="business-create"),
    path("businesses/<int:business_id>/", BusinessUpdateView.as_view(), name="business-update"),
    path("businesses/<int:business_id>/logo/", BusinessLogoView.as_view(), name="business-logo"),
]
