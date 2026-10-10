from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from accounts.views import ChangePinView, LoginView, MeView

urlpatterns = [
    path("login", LoginView.as_view(), name="login"),
    path("refresh", TokenRefreshView.as_view(), name="token-refresh"),
    path("me", MeView.as_view(), name="me"),
    path("change-pin", ChangePinView.as_view(), name="change-pin"),
]
