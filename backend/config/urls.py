from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path

from config.views import health

urlpatterns = [
    path("api/v1/health/", health, name="health"),
    path("api/v1/", include("accounts.urls")),
    path("api/v1/", include("businesses.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
