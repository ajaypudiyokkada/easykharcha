from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from core.views import health

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health", health, name="health"),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("tenants.urls")),
    path("api/", include("inventory.urls")),
    path("api/", include("recipes.urls")),
    path("api/", include("imports.urls")),
    path("api/", include("reports.urls")),
    path("api/", include("audit.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
