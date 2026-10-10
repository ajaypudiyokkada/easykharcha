from django.conf import settings
from rest_framework import serializers

from accounts.models import Access, User
from core.roles import TENANT_ROLES, Role


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "phone", "name", "active", "must_change_pin")
        read_only_fields = ("id", "must_change_pin")


class LoginSerializer(serializers.Serializer):
    phone = serializers.CharField()
    pin = serializers.CharField(write_only=True, trim_whitespace=False)


class ChangePinSerializer(serializers.Serializer):
    current_pin = serializers.CharField(write_only=True, trim_whitespace=False)
    new_pin = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_new_pin(self, value: str) -> str:
        length = settings.PIN_LENGTH
        if not value.isdigit() or len(value) != length:
            raise serializers.ValidationError(f"PIN must be exactly {length} digits.")
        return value

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.check_pin(attrs["current_pin"]):
            raise serializers.ValidationError({"current_pin": "Current PIN is incorrect."})
        if attrs["current_pin"] == attrs["new_pin"]:
            raise serializers.ValidationError({"new_pin": "New PIN must differ from the old one."})
        return attrs


class AccessSerializer(serializers.ModelSerializer):
    phone = serializers.CharField(source="user.phone", read_only=True)
    name = serializers.CharField(source="user.name", read_only=True)
    user_active = serializers.BooleanField(source="user.active", read_only=True)

    class Meta:
        model = Access
        fields = ("id", "user", "phone", "name", "user_active", "role", "active")
        read_only_fields = ("id", "user")


class AccessWriteSerializer(serializers.Serializer):
    """Grant a role by phone number — an Owner adding staff does not know internal user ids.

    Creating a user as a side effect of granting access is deliberate: in a restaurant the Owner adds a
    new cook by typing their phone number, not by sending them through a signup flow first.
    """

    phone = serializers.CharField()
    name = serializers.CharField(required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=Role.choices)
    pin = serializers.CharField(required=False, write_only=True, trim_whitespace=False)

    def validate_role(self, value: str) -> str:
        if value == Role.SUPER_ADMIN:
            # Granted through POST /api/tenants/<id>/access with role=super_admin, which the view
            # routes to accounts.services.grant_super_admin; the tenant dropdown must not offer it.
            return value
        if value not in {r.value for r in TENANT_ROLES}:
            raise serializers.ValidationError("Unknown role.")
        return value

    def validate_pin(self, value: str) -> str:
        length = settings.PIN_LENGTH
        if not value.isdigit() or len(value) != length:
            raise serializers.ValidationError(f"PIN must be exactly {length} digits.")
        return value
