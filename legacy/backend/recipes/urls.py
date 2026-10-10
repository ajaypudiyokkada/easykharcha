from django.urls import include, path
from rest_framework.routers import DefaultRouter

from recipes.views import CanonicalIngredientViewSet, RecipeAdoptView, RecipeTemplateViewSet

router = DefaultRouter()
router.register("recipe-templates", RecipeTemplateViewSet, basename="recipe-template")
router.register(
    "canonical-ingredients", CanonicalIngredientViewSet, basename="canonical-ingredient"
)

urlpatterns = [
    path("", include(router.urls)),
    path(
        "tenants/<int:tenant_id>/dishes/<int:pk>/recipe/adopt",
        RecipeAdoptView.as_view(),
        name="recipe-adopt",
    ),
]
