from rest_framework import serializers

from .limits import MAX_DISHES_PER_RECIPE_CALL


class RecipeSuggestionDishSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=80, allow_blank=False, trim_whitespace=True)


class RecipeSuggestionRequestSerializer(serializers.Serializer):
    dish_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, allow_empty=False
    )
    dishes = serializers.ListField(
        child=RecipeSuggestionDishSerializer(), required=False, allow_empty=False
    )

    def validate(self, attrs):
        dish_ids = attrs.get("dish_ids")
        dishes = attrs.get("dishes")
        if bool(dish_ids) == bool(dishes):
            raise serializers.ValidationError("Provide either dish_ids or dishes, not both.")
        count = len(dish_ids or dishes)
        if count > MAX_DISHES_PER_RECIPE_CALL:
            raise serializers.ValidationError(
                f"Up to {MAX_DISHES_PER_RECIPE_CALL} dishes per call."
            )
        return attrs
