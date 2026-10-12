from django.urls import path

from .business_settings import BusinessSettingsView
from .team import TeamListCreateView, TeamMemberDetailView
from .views import (
    BusinessCreateView,
    BusinessLogoView,
    BusinessUpdateView,
    OnboardingCompleteView,
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
    path(
        "businesses/<int:business_id>/onboarding/complete/",
        OnboardingCompleteView.as_view(),
        name="onboarding-complete",
    ),
    path("businesses/<int:business_id>/team/", TeamListCreateView.as_view(), name="team-list"),
    path(
        "businesses/<int:business_id>/team/<int:access_id>/",
        TeamMemberDetailView.as_view(),
        name="team-detail",
    ),
    path(
        "businesses/<int:business_id>/settings/",
        BusinessSettingsView.as_view(),
        name="business-settings",
    ),
    path("starter-packs/<str:business_type>/", StarterPackView.as_view(), name="starter-pack"),
]
