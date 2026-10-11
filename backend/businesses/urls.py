from django.urls import path

from .views import (
    BusinessCreateView,
    BusinessLogoView,
    BusinessUpdateView,
    OnboardingListView,
    OnboardingStepView,
    StarterPackView,
)

urlpatterns = [
    path("businesses/", BusinessCreateView.as_view(), name="business-create"),
    path("businesses/<int:business_id>/", BusinessUpdateView.as_view(), name="business-update"),
    path("businesses/<int:business_id>/logo/", BusinessLogoView.as_view(), name="business-logo"),
    path(
        "businesses/<int:business_id>/onboarding/",
        OnboardingListView.as_view(),
        name="onboarding-list",
    ),
    path(
        "businesses/<int:business_id>/onboarding/<int:step>/",
        OnboardingStepView.as_view(),
        name="onboarding-step",
    ),
    path("starter-packs/<str:business_type>/", StarterPackView.as_view(), name="starter-pack"),
]
