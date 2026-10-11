from rest_framework import serializers

from .colour import white_text_contrast
from .models import Business, BusinessType, hex_colour_validator


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

    def save(self, **kwargs) -> Business:
        business: Business = self.instance
        for field, value in self.validated_data.items():
            setattr(business, field, value)
        business.save()
        return business


class BusinessSerializer(serializers.ModelSerializer):
    logo = serializers.SerializerMethodField()

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
            "created_at",
        )

    def get_logo(self, obj: Business) -> str | None:
        if not obj.logo:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(obj.logo.url) if request else obj.logo.url
