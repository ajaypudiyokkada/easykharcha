from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.exceptions import DuplicateMobile, InvalidCredentials, RateLimited
from accounts.models import User
from accounts.ratelimit import get_client_ip, hit
from accounts.serializers import LoginSerializer, LogoutSerializer, SignupSerializer, UserSerializer
from businesses.creation import create_business
from businesses.models import Business
from businesses.serializers import BusinessSerializer


def _tokens_for(user: User) -> dict:
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


class SignupView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        # Checked before validation on purpose: a bot fills every field, including this hidden one,
        # so there's no reason to spend a real validation pass or a database query on it.
        if request.data.get("website"):
            return Response(
                {
                    "id": 0,
                    "name": request.data.get("name", ""),
                    "mobile": request.data.get("mobile", ""),
                },
                status=201,
            )

        ip = get_client_ip(request)
        limit, window = settings.RATE_LIMITS["signup_per_ip"]
        if not hit(f"signup:ip:{ip}", limit, window):
            raise RateLimited()

        serializer = SignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        limit, window = settings.RATE_LIMITS["signup_per_mobile"]
        if not hit(f"signup:mobile:{data['mobile']}", limit, window):
            raise RateLimited()

        if User.objects.filter(mobile=data["mobile"]).exists():
            raise DuplicateMobile()

        with transaction.atomic():
            user = User.objects.create_user(
                mobile=data["mobile"],
                name=data["name"],
                password=data["password"],
                email=data.get("email", ""),
                consent_at=timezone.now(),
                consent_version=settings.CONSENT_VERSION,
                utm_source=data.get("utm_source", ""),
                utm_medium=data.get("utm_medium", ""),
                utm_campaign=data.get("utm_campaign", ""),
            )
            # Step F2: the business is created right here, with only its name — the onboarding
            # wizard's first step fills in type/location later and never asks for the name again.
            create_business(user=user, name=data["business_name"])
        return Response(UserSerializer(user).data, status=201)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        ip = get_client_ip(request)
        limit, window = settings.RATE_LIMITS["login_per_ip"]
        if not hit(f"login:ip:{ip}", limit, window):
            raise RateLimited()

        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        mobile = serializer.validated_data["mobile"]
        secret = serializer.validated_data["secret"]

        try:
            user = User.objects.get(mobile=mobile)
        except User.DoesNotExist:
            # Unknown mobile: no uses_pin to key off, so just the default (looser) limit.
            limit, window = settings.RATE_LIMITS["login_per_mobile"]
            if not hit(f"login:mobile:{mobile}", limit, window):
                raise RateLimited() from None
            raise InvalidCredentials() from None

        # A 4-6 digit PIN has far fewer combinations than a password, so both the rate limit and
        # the lockout threshold are stricter for a PIN account.
        limit, window = settings.RATE_LIMITS[
            "login_per_mobile_pin" if user.uses_pin else "login_per_mobile"
        ]
        if not hit(f"login:mobile:{mobile}", limit, window):
            raise RateLimited()
        lockout_threshold = (
            settings.PIN_LOGIN_LOCKOUT_THRESHOLD
            if user.uses_pin
            else settings.LOGIN_LOCKOUT_THRESHOLD
        )

        # Same generic error whether the account is locked, the password is wrong, or the mobile
        # doesn't exist at all — anything else would let an attacker tell those cases apart.
        if user.is_locked() or not user.check_password(secret):
            if not user.is_locked():
                user.failed_login_count += 1
                if user.failed_login_count >= lockout_threshold:
                    user.locked_until = timezone.now() + timezone.timedelta(
                        minutes=settings.LOGIN_LOCKOUT_MINUTES
                    )
                user.save(update_fields=["failed_login_count", "locked_until"])
            raise InvalidCredentials()

        user.failed_login_count = 0
        user.locked_until = None
        user.last_login = timezone.now()
        user.save(update_fields=["failed_login_count", "locked_until", "last_login"])
        return Response(_tokens_for(user))


class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            RefreshToken(serializer.validated_data["refresh"]).blacklist()
        except TokenError as exc:
            raise InvalidCredentials("That session is already signed out.") from exc
        return Response({"detail": "Logged out."})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        businesses = Business.objects.filter(access__user=request.user)
        return Response(
            {
                "user": UserSerializer(request.user).data,
                "businesses": BusinessSerializer(
                    businesses, many=True, context={"request": request}
                ).data,
            }
        )
