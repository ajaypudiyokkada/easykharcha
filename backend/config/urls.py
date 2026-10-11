from django.urls import include, path

from config.views import health

urlpatterns = [
    path("api/v1/health/", health, name="health"),
    path("api/v1/", include("accounts.urls")),
]
