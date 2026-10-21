from django.utils import timezone
from rest_framework import serializers

from geo.models import Pincode
from geo.states import INDIA_STATES

from .colour import white_text_contrast
from .models import (
    SKIPPABLE_ONBOARDING_STEPS,
    Business,
    BusinessType,
    OnboardingProgress,
    OnboardingStepStatus,
    hex_colour_validator,
)
from .permissions import permissions_for


def validate_brand_colour(value: str) -> str:
    hex_colour_validator(value)
    if white_text_contrast(value) < 4.5:
        raise serializers.ValidationError(
            "This colour is too light for white text to read clearly. Try a darker shade."
        )
    return value


def validate_pincode_location(attrs: dict, instance: Business | None) -> dict:
    """Shared by create and update: a pincode in `attrs` either doesn't need checking against the
    Pincode table (`manual_location`, popped here so it never reaches `Business.objects.create`/
    `save`) or must exist and agree with the city/state also being set. Only runs when `pincode` is
    actually present in this request — an update that doesn't touch it leaves whatever the business
    already has alone."""
    manual = attrs.pop("manual_location", False)
    if "pincode" not in attrs:
        return attrs

    pincode = attrs["pincode"]
    if not pincode:
        return attrs

    rows = list(Pincode.objects.filter(pincode=pincode))
    if not rows:
        if manual:
            return attrs
        raise serializers.ValidationError(
            {"pincode": "We couldn't find that pincode. Turn on manual entry to use it anyway."}
        )

    if manual:
        given_state = attrs.get("state")
        if given_state and given_state not in INDIA_STATES:
            raise serializers.ValidationError({"state": "Choose a state from the list."})
        return attrs

    districts = {row.district for row in rows}
    areas = {row.area for row in rows}
    city = attrs.get("city") or (instance.city if instance else "")
    if city not in districts and city not in areas:
        allowed = ", ".join(sorted(districts | areas))
        raise serializers.ValidationError(
            {"city": f"City must match this pincode's area — one of: {allowed}."}
        )

    state = rows[0].state
    given_state = attrs.get("state")
    if given_state and given_state.strip().lower() != state.lower():
        raise serializers.ValidationError(
            {"state": f"This pincode is in {state}, not {given_state}."}
        )
    attrs["state"] = state
    return attrs


class BusinessCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    business_type = serializers.ChoiceField(choices=BusinessType.choices)
    city = serializers.CharField(max_length=120)
    pincode = serializers.CharField(max_length=6, required=False, allow_blank=True, default="")
    state = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    tagline = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")
    # Write-only: bypasses the pincode/city/state cross-check below, never a model field.
    manual_location = serializers.BooleanField(required=False, write_only=True, default=False)

    def validate(self, attrs: dict) -> dict:
        return validate_pincode_location(attrs, None)


class BusinessUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120, required=False)
    business_type = serializers.ChoiceField(choices=BusinessType.choices, required=False)
    city = serializers.CharField(max_length=120, required=False)
    pincode = serializers.CharField(max_length=6, required=False, allow_blank=True)
    state = serializers.CharField(max_length=64, required=False, allow_blank=True)
    tagline = serializers.CharField(max_length=160, required=False, allow_blank=True)
    primary_colour = serializers.CharField(required=False, validators=[validate_brand_colour])
    onboarding_step = serializers.IntegerField(required=False, min_value=1, max_value=6)
    # Write-only: true means "set checklist_dismissed_at to now", not a literal model field.
    dismiss_checklist = serializers.BooleanField(required=False, write_only=True)
    # Write-only: bypasses the pincode/city/state cross-check below, never a model field.
    manual_location = serializers.BooleanField(required=False, write_only=True, default=False)

    def validate(self, attrs: dict) -> dict:
        return validate_pincode_location(attrs, self.instance)

    def save(self, **kwargs) -> Business:
        business: Business = self.instance
        for field, value in self.validated_data.items():
            if field == "dismiss_checklist":
                if value:
                    business.checklist_dismissed_at = timezone.now()
                continue
            setattr(business, field, value)
        business.save()
        return business


class OnboardingStepSerializer(serializers.ModelSerializer):
    class Meta:
        model = OnboardingProgress
        fields = ("step", "status")


class OnboardingUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=OnboardingStepStatus.choices)

    def validate(self, attrs: dict) -> dict:
        step = self.context["step"]
        if (
            attrs["status"] == OnboardingStepStatus.SKIPPED
            and step not in SKIPPABLE_ONBOARDING_STEPS
        ):
            raise serializers.ValidationError({"status": "This step can't be skipped."})
        return attrs


class BusinessSerializer(serializers.ModelSerializer):
    logo = serializers.SerializerMethodField()
    onboarding = serializers.SerializerMethodField()
    skipped_steps = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Business
        fields = (
            "id",
            "name",
            "business_type",
            "city",
            "pincode",
            "state",
            "country",
            "tagline",
            "primary_colour",
            "logo",
            "timezone",
            "currency",
            "onboarding_step",
            "onboarding_completed_at",
            "onboarding",
            "skipped_steps",
            "role",
            "permissions",
            "checklist_dismissed_at",
            "created_at",
        )

    def get_logo(self, obj: Business) -> str | None:
        if not obj.logo:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(obj.logo.url) if request else obj.logo.url

    def get_onboarding(self, obj: Business) -> list:
        return OnboardingStepSerializer(obj.onboarding_progress.all(), many=True).data

    def get_skipped_steps(self, obj: Business) -> list[int]:
        return [
            progress.step
            for progress in obj.onboarding_progress.all()
            if progress.status == OnboardingStepStatus.SKIPPED
        ]

    def get_role(self, obj: Business) -> str | None:
        """The requesting user's own role on this business — not necessarily Owner, now that team
        members can log in too."""
        request = self.context.get("request")
        if not request or not getattr(request, "user", None) or not request.user.is_authenticated:
            return None
        access = obj.access.filter(user=request.user).first()
        return access.role if access else None

    def get_permissions(self, obj: Business) -> list[str]:
        request = self.context.get("request")
        if not request or not getattr(request, "user", None) or not request.user.is_authenticated:
            return []
        access = obj.access.filter(user=request.user).first()
        if not access:
            return []
        return sorted(permissions_for(access.role))
