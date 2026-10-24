from decimal import Decimal

from rest_framework import serializers

from .models import SellItem, SellItemIngredient, StockItem, Unit

ZERO = Decimal("0")
# An ingredient quantity states "one portion uses this much of the stock item" — 0 isn't a
# meaningful answer to that, so a provided value must be a real positive amount.
MIN_POSITIVE_QTY = Decimal("0.001")
MAX_INGREDIENT_QTY = Decimal("100000")


def _clean_group(value: str) -> str:
    return value.strip()


class StockItemRowSerializer(serializers.Serializer):
    """One row of a bulk stock-items create. Only format/range checks here — name-uniqueness and
    cross-row checks need the whole batch, so the view does those."""

    name = serializers.CharField(max_length=120)
    unit = serializers.ChoiceField(choices=Unit.choices)
    usual_price = serializers.DecimalField(
        max_digits=12, decimal_places=4, required=False, allow_null=True, min_value=ZERO
    )
    supplier = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    shared = serializers.BooleanField(required=False, default=False)
    goes_off = serializers.BooleanField(required=False, default=False)
    shelf_life_days = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    group = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name.")
        return value

    def validate_group(self, value: str) -> str:
        return _clean_group(value)

    def validate(self, attrs: dict) -> dict:
        # Only meaningful when goes_off is set — normalised here so a stray value from a toggle
        # the user flipped back off never lingers in the saved row.
        if not attrs.get("goes_off"):
            attrs["shelf_life_days"] = None
        elif attrs.get("shelf_life_days") is None:
            raise serializers.ValidationError(
                {"shelf_life_days": "Enter a shelf life in days, or turn that off."}
            )
        return attrs


class StockItemUpdateSerializer(serializers.Serializer):
    """PATCH stock-items/<id>/ — every field optional (partial update). Only format/range checks
    here; name-uniqueness, the unit lock, and the in-use check all need a query, so the view does
    those — same split as StockItemRowSerializer above."""

    name = serializers.CharField(max_length=120, required=False)
    unit = serializers.ChoiceField(choices=Unit.choices, required=False)
    usual_price = serializers.DecimalField(
        max_digits=12, decimal_places=4, required=False, allow_null=True, min_value=ZERO
    )
    supplier = serializers.CharField(max_length=120, required=False, allow_blank=True)
    shared = serializers.BooleanField(required=False)
    goes_off = serializers.BooleanField(required=False)
    shelf_life_days = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    group = serializers.CharField(max_length=40, required=False, allow_blank=True)
    active = serializers.BooleanField(required=False)

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name.")
        return value

    def validate_group(self, value: str) -> str:
        return _clean_group(value)

    def validate(self, attrs: dict) -> dict:
        # Only clears shelf_life_days when goes_off is explicitly turned off in this request — a
        # PATCH that doesn't mention goes_off at all (e.g. just renaming) must leave it alone.
        if "goes_off" in attrs and not attrs["goes_off"]:
            attrs["shelf_life_days"] = None
        elif attrs.get("goes_off") and attrs.get("shelf_life_days") is None:
            raise serializers.ValidationError(
                {"shelf_life_days": "Enter a shelf life in days, or turn that off."}
            )
        return attrs


class StockItemSerializer(serializers.ModelSerializer):
    # Populated via annotation (see StockItemListView/StockItemDetailView) from this item's purchase
    # history — plain declared fields here just expose whatever the queryset already computed, same
    # as any other read-only field. None for an item that's never been bought yet.
    last_unit_price = serializers.DecimalField(
        max_digits=12, decimal_places=4, read_only=True, default=None
    )
    last_purchased_at = serializers.DateTimeField(read_only=True, default=None)
    # Step 10: populated via annotation too (see _with_last_count_info). Deliberately no "on hand"
    # or gap field — that needs usage math this step doesn't build yet.
    last_counted_qty = serializers.DecimalField(
        max_digits=10, decimal_places=3, read_only=True, default=None
    )
    last_counted_at = serializers.DateTimeField(read_only=True, default=None)

    class Meta:
        model = StockItem
        fields = (
            "id",
            "name",
            "unit",
            "usual_price",
            "supplier",
            "shared",
            "goes_off",
            "shelf_life_days",
            "group",
            "active",
            "created_at",
            "last_unit_price",
            "last_purchased_at",
            "last_counted_qty",
            "last_counted_at",
        )


def _clean_portion_label(value: str) -> str:
    return value.strip()


class SellItemRowSerializer(serializers.Serializer):
    """One row of a bulk sell-items create — deliberately carries no ingredients (Step 22a): this
    is the "quick setup" path (the wizard, starter-pack items), always landing at
    recipe_status=none. Attaching ingredients is the manual dish form's job, see
    SellItemCreateSerializer below — not exposed anywhere in the UI yet."""

    name = serializers.CharField(max_length=120)
    selling_price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=ZERO)
    portion_label = serializers.CharField(
        max_length=40, required=False, allow_blank=True, default=""
    )
    group = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name.")
        return value

    def validate_group(self, value: str) -> str:
        return _clean_group(value)

    def validate_portion_label(self, value: str) -> str:
        return _clean_portion_label(value)


class IngredientRowSerializer(serializers.Serializer):
    """One ingredient row of a dish — quantity is always in the stock item's own unit (the client
    converts g/ml/pieces to it before sending, see mobile/src/forms/unitConversion.ts)."""

    stock_item = serializers.IntegerField()
    quantity = serializers.DecimalField(
        max_digits=10,
        decimal_places=3,
        min_value=MIN_POSITIVE_QTY,
        max_value=MAX_INGREDIENT_QTY,
    )


def _validate_ingredient_rows(rows: list[dict]) -> list[dict]:
    if not rows:
        raise serializers.ValidationError("Add at least one ingredient.")
    seen_stock_item_ids: set[int] = set()
    for row in rows:
        if row["stock_item"] in seen_stock_item_ids:
            raise serializers.ValidationError("Each ingredient can only be used once in a dish.")
        seen_stock_item_ids.add(row["stock_item"])
    return rows


class SellItemCreateSerializer(serializers.Serializer):
    """POST sell-items/ — the manual dish form's single-item create, with its full recipe (Step
    22a). The view resolves `ingredients[].stock_item` against this business's own, non-shared
    stock items; a dish can't be saved without at least one valid one, so this always lands at
    recipe_status=confirmed."""

    name = serializers.CharField(max_length=120)
    selling_price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=ZERO)
    portion_label = serializers.CharField(
        max_length=40, required=False, allow_blank=True, default=""
    )
    group = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    ingredients = IngredientRowSerializer(many=True)

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name.")
        return value

    def validate_group(self, value: str) -> str:
        return _clean_group(value)

    def validate_portion_label(self, value: str) -> str:
        return _clean_portion_label(value)

    def validate_ingredients(self, value: list[dict]) -> list[dict]:
        return _validate_ingredient_rows(value)


class SellItemUpdateSerializer(serializers.Serializer):
    """PATCH sell-items/<id>/ — every field optional (partial update). `ingredients`, when present
    at all, fully replaces the dish's ingredient rows under the same rule as create (at least one,
    no duplicates) and re-confirms the recipe — editing a dish still goes through the same form.
    Cross-field checks that need a query (stock items must belong to this business, not be shared)
    are the view's job, same split as StockItemUpdateSerializer."""

    name = serializers.CharField(max_length=120, required=False)
    selling_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, min_value=ZERO
    )
    portion_label = serializers.CharField(max_length=40, required=False, allow_blank=True)
    group = serializers.CharField(max_length=40, required=False, allow_blank=True)
    ingredients = IngredientRowSerializer(many=True, required=False)
    active = serializers.BooleanField(required=False)

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name.")
        return value

    def validate_group(self, value: str) -> str:
        return _clean_group(value)

    def validate_portion_label(self, value: str) -> str:
        return _clean_portion_label(value)

    def validate_ingredients(self, value: list[dict]) -> list[dict]:
        return _validate_ingredient_rows(value)


class SellItemIngredientSerializer(serializers.ModelSerializer):
    stock_item_name = serializers.CharField(source="stock_item.name", read_only=True)
    unit = serializers.CharField(source="stock_item.unit", read_only=True)

    class Meta:
        model = SellItemIngredient
        fields = ("id", "stock_item", "stock_item_name", "unit", "quantity")


class SellItemSerializer(serializers.ModelSerializer):
    ingredients = SellItemIngredientSerializer(many=True, read_only=True)

    class Meta:
        model = SellItem
        fields = (
            "id",
            "name",
            "selling_price",
            "portion_label",
            "recipe_status",
            "ingredients",
            "group",
            "active",
            "created_at",
        )
