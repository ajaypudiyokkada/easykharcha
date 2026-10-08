from django.contrib.auth.hashers import make_password
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import User
from accounts.serializers import ChangePinSerializer, LoginSerializer, UserSerializer
from audit.services import log
from core.permissions import IsAuthenticatedActive
from core.roles import capabilities_for
from core.tenancy import accessible_businesses, global_super_admin_access, role_at

#: Burned once at import so a wrong phone number costs the same time as a wrong PIN. Without this, a
#: 4-digit PIN endpoint also leaks which phone numbers are registered, by response time.
_DUMMY_HASH = make_password("0" * 12)


def tokens_for(user: User) -> dict:
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


def session_payload(user: User) -> dict:
    """What the client needs immediately after authenticating: identity + where it may go."""
    businesses = list(accessible_businesses(user))
    is_sa = global_super_admin_access(user) is not None
    tenants = [
        {
            "id": b.id,
            "name": b.name,
            "tagline": b.tagline,
            "business_type": b.business_type,
            "business_type_label": b.get_business_type_display(),
            "primary_colour": b.primary_colour,
            "accent_colour": b.accent_colour,
            "logo": b.logo.url if b.logo else None,
            "role": role_at(user, b.id),
        }
        for b in businesses
    ]
    for tenant in tenants:
        tenant["capabilities"] = capabilities_for(tenant["role"]) if tenant["role"] else []
    return {
        "user": UserSerializer(user).data,
        "is_super_admin": is_sa,
        "tenants": tenants,
        # One tenant -> the client goes straight in; more than one -> it shows the picker (§2).
        "needs_tenant_picker": len(tenants) != 1,
    }


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data["phone"].strip()
        pin = serializer.validated_data["pin"]

        user = User.objects.filter(phone=phone).first()
        if user is None:
            from django.contrib.auth.hashers import check_password

            check_password(pin, _DUMMY_HASH)  # constant-ish time; see _DUMMY_HASH above
            return _invalid()
        if not user.active or not user.check_pin(pin):
            return _invalid()

        payload = session_payload(user)
        if not payload["tenants"] and not payload["is_super_admin"]:
            return Response(
                {
                    "error": {
                        "code": "no_access",
                        "message": "Your account has no access yet. Ask the owner to add you.",
                        "detail": {},
                    }
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        return Response({**tokens_for(user), **payload})


def _invalid():
    return Response(
        {
            "error": {
                "code": "invalid_credentials",
                "message": "Phone number or PIN is incorrect.",
                "detail": {},
            }
        },
        status=status.HTTP_401_UNAUTHORIZED,
    )


class MeView(APIView):
    permission_classes = [IsAuthenticatedActive]

    def get(self, request):
        return Response(session_payload(request.user))


class ChangePinView(APIView):
    permission_classes = [IsAuthenticatedActive]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        serializer = ChangePinSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = request.user
        user.set_pin(serializer.validated_data["new_pin"])
        user.must_change_pin = False
        user.save(update_fields=["password", "must_change_pin", "updated_at"])
        # The PIN itself never reaches the audit log — audit.services.scrub drops it even if passed.
        log(None, "user.change_pin", summary=f"{user.phone} changed their PIN", user=user)
        return Response({"status": "ok"})
