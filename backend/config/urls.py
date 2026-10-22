from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from config.views import health

urlpatterns = [
    # Not /admin/ — see ADMIN_URL_PATH in config/settings.py and deploy/.env.production.example.
    path(settings.ADMIN_URL_PATH, admin.site.urls),
    path("api/v1/health/", health, name="health"),
    path("api/v1/", include("accounts.urls")),
    path("api/v1/", include("businesses.urls")),
    path("api/v1/", include("geo.urls")),
    path("api/v1/", include("stock.urls")),
    path("api/v1/", include("purchases.urls")),
    path("api/v1/", include("counts.urls")),
    path("api/v1/", include("wastage.urls")),
    path("api/v1/", include("sales.urls")),
    path("api/v1/", include("alerts.urls")),
    path("api/v1/", include("reports.urls")),
    path("api/v1/", include("ai.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
