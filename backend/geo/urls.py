from django.urls import path

from .views import PincodeDetailView

urlpatterns = [
    path("geo/pincode/<str:code>/", PincodeDetailView.as_view(), name="pincode-detail"),
]
