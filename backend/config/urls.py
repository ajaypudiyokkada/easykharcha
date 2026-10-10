from django.urls import path

from config.views import health

urlpatterns = [
    path("api/v1/health/", health, name="health"),
]
