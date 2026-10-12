from django.utils import timezone
from rest_framework import serializers

from .colour import white_text_contrast
from .models import (
    SKIPPABLE_ONBOARDING_STEPS,
    Business,
    BusinessType,
    OnboardingProgress,
    OnboardingStepStatus,
    hex_colour_validator,
)


def validate_brand_colour(value: str) -> str:
    hex_colour_validator(value)
    if white_text_contrast(value) < 4.5:
        raise serializers.ValidationError(
            "This colour is too light for white text to read clearly. Try a darker shade."
        )
    return value


class BusinessCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    business_type = serializers.ChoiceField(choices=BusinessType.choices)
    city = serializers.CharField(max_length=120)
    tagline = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")


class BusinessUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120, required=False)
    business_type = serializers.ChoiceField(choices=BusinessType.choices, required=False)
    city = serializers.CharField(max_length=120, required=False)
    tagline = serializers.CharField(max_length=160, required=False, allow_blank=True)
    primary_colour = serializers.CharField(required=False, validators=[validate_brand_colour])
    onboarding_step = serializers.IntegerField(required=False, min_value=1, max_value=6)
    # Write-only: true means "set checklist_dismissed_at to now", not a literal model field.
    dismiss_checklist = serializers.BooleanField(required=False, write_only=True)

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

    class Meta:
        model = Business
        fields = (
            "id",
            "name",
            "business_type",
            "city",
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
