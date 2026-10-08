from django.urls import include, path
from rest_framework.routers import DefaultRouter

from inventory.views import (
    DayView,
    DishViewSet,
    EntryCorrectionView,
    HomeView,
    IngredientViewSet,
    PurchaseViewSet,
    RecentEntriesView,
    RecipeLineViewSet,
    RequestViewSet,
    SalesImportViewSet,
    SaleViewSet,
    StockCloseView,
    StockListView,
    StockOpenView,
    VendorViewSet,
    WastageViewSet,
)

router = DefaultRouter()
router.register("vendors", VendorViewSet, basename="vendor")
router.register("ingredients", IngredientViewSet, basename="ingredient")
router.register("dishes", DishViewSet, basename="dish")
router.register("recipe-lines", RecipeLineViewSet, basename="recipe-line")
router.register("wastage", WastageViewSet, basename="wastage")
router.register("purchases", PurchaseViewSet, basename="purchase")
router.register("sales", SaleViewSet, basename="sale")
router.register("requests", RequestViewSet, basename="request")
router.register("sales-imports", SalesImportViewSet, basename="sales-import")

urlpatterns = [
    path("tenants/<int:tenant_id>/", include(router.urls)),
    path("tenants/<int:tenant_id>/home", HomeView.as_view(), name="home"),
    path("tenants/<int:tenant_id>/stock", StockListView.as_view(), name="stock-list"),
    path("tenants/<int:tenant_id>/stock/open", StockOpenView.as_view(), name="stock-open"),
    path("tenants/<int:tenant_id>/stock/close", StockCloseView.as_view(), name="stock-close"),
    path("tenants/<int:tenant_id>/recent", RecentEntriesView.as_view(), name="recent-entries"),
    path("tenants/<int:tenant_id>/day/<str:date>", DayView.as_view(), name="day"),
    path(
        "tenants/<int:tenant_id>/entries/<str:table>/<int:pk>",
        EntryCorrectionView.as_view(),
        name="entry-correction",
    ),
]
