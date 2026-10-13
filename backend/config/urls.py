from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path

from config.views import health

urlpatterns = [
    path("api/v1/health/", health, name="health"),
    path("api/v1/", include("accounts.urls")),
    path("api/v1/", include("businesses.urls")),
    path("api/v1/", include("stock.urls")),
    path("api/v1/", include("purchases.urls")),
    path("api/v1/", include("counts.urls")),
    path("api/v1/", include("wastage.urls")),
    path("api/v1/", include("sales.urls")),
    path("api/v1/", include("alerts.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
