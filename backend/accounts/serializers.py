from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from accounts.models import User, mobile_validator


def validate_password_rules(password: str, mobile: str, name: str) -> None:
    """Shared with businesses/team.py — a Manager's temporary password follows the same policy a
    sign-up password does."""
    try:
        validate_password(password)
    except DjangoValidationError as exc:
        raise serializers.ValidationError({"password": exc.messages}) from exc
    if password == mobile or (name and password.lower() == name.strip().lower()):
        raise serializers.ValidationError(
            {"password": ["Password cannot be the same as your mobile number or name."]}
        )


class SignupSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    # Step F2: collected once, here, and used as the new Business's name — the onboarding wizard
    # never asks for it again (see accounts/views.py's SignupView and businesses/creation.py).
    business_name = serializers.CharField(max_length=120)
    mobile = serializers.CharField(max_length=10, validators=[mobile_validator])
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    consent = serializers.BooleanField()
    utm_source = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    utm_medium = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    utm_campaign = serializers.CharField(
        max_length=120, required=False, allow_blank=True, default=""
    )
    # Honeypot — hidden on the real form, so only a bot fills it in. The view checks this field
    # before anything else and short-circuits to a fake success; it is never saved anywhere.
    website = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_consent(self, value: bool) -> bool:
        if not value:
            raise serializers.ValidationError("Consent is required.")
        return value

    def validate(self, attrs: dict) -> dict:
        validate_password_rules(attrs["password"], attrs["mobile"], attrs.get("name", ""))
        return attrs


class LoginSerializer(serializers.Serializer):
    mobile = serializers.CharField(max_length=10)
    secret = serializers.CharField(write_only=True, trim_whitespace=False)


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "name", "mobile", "email")
