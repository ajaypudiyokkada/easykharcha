from rest_framework import serializers

from recipes.models import CanonicalIngredient, RecipeTemplate, RecipeTemplateLine


class CanonicalIngredientSerializer(serializers.ModelSerializer):
    class Meta:
        model = CanonicalIngredient
        fields = ("id", "code", "name", "category", "default_unit", "avg_piece_weight_g")


class RecipeTemplateLineSerializer(serializers.ModelSerializer):
    canonical_code = serializers.CharField(source="canonical.code", read_only=True)
    canonical_name = serializers.CharField(source="canonical.name", read_only=True)
    confidence_label = serializers.CharField(source="get_confidence_display", read_only=True)

    class Meta:
        model = RecipeTemplateLine
        fields = (
            "id",
            "canonical",
            "canonical_code",
            "canonical_name",
            "qty_per_portion",
            "unit",
            "basis",
            "size_multipliers",
            "confidence",
            "confidence_label",
        )


class RecipeTemplateSerializer(serializers.ModelSerializer):
    lines = RecipeTemplateLineSerializer(many=True, read_only=True)

    class Meta:
        model = RecipeTemplate
        fields = (
            "id",
            "code",
            "name",
            "cuisine",
            "category",
            "portion_label",
            "pieces_per_portion",
            "lines",
        )


class AdoptSerializer(serializers.Serializer):
    template = serializers.CharField(help_text="Template code")
    size = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    #: canonical code -> tenant ingredient id, resolving the preview's ambiguous rows.
    choices = serializers.DictField(child=serializers.IntegerField(), required=False)
    replace = serializers.BooleanField(default=False)
