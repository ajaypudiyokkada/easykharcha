from django.urls import path

from .views import EkSetupView, MenuScanCreateView, MenuScanDetailView, RecipeSuggestionView

urlpatterns = [
    path(
        "businesses/<int:business_id>/ai/menu-scans/",
        MenuScanCreateView.as_view(),
        name="ai-menu-scan-create",
    ),
    path(
        "businesses/<int:business_id>/ai/menu-scans/<int:scan_id>/",
        MenuScanDetailView.as_view(),
        name="ai-menu-scan-detail",
    ),
    path(
        "businesses/<int:business_id>/ai/menu-scans/<int:scan_id>/ek-setup/",
        EkSetupView.as_view(),
        name="ai-ek-setup",
    ),
    path(
        "businesses/<int:business_id>/ai/recipe-suggestions/",
        RecipeSuggestionView.as_view(),
        name="ai-recipe-suggestions",
    ),
]
