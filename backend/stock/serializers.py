from decimal import Decimal

from rest_framework import serializers

from .models import SellItem, StockItem, Unit

ZERO = Decimal("0")


class StockItemRowSerializer(serializers.Serializer):
    """One row of a bulk stock-items create. Only format/range checks here — name-uniqueness and
    cross-row checks need the whole batch, so the view does those."""

    name = serializers.CharField(max_length=120)
    unit = serializers.ChoiceField(choices=Unit.choices)
    usual_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True, min_value=ZERO
    )
    supplier = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    shared = serializers.BooleanField(required=False, default=False)
    goes_off = serializers.BooleanField(required=False, default=False)
    shelf_life_days = serializers.IntegerField(required=False, allow_null=True, min_value=0)

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name.")
        return value

    def validate(self, attrs: dict) -> dict:
        # Only meaningful when goes_off is set — normalised here so a stray value from a toggle
        # the user flipped back off never lingers in the saved row.
        if not attrs.get("goes_off"):
            attrs["shelf_life_days"] = None
        return attrs


class StockItemSerializer(serializers.ModelSerializer):
    # Populated via annotation (see StockItemListView/StockItemDetailView) from this item's purchase
    # history — plain declared fields here just expose whatever the queryset already computed, same
    # as any other read-only field. None for an item that's never been bought yet.
    last_unit_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, read_only=True, default=None
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
            "active",
            "created_at",
            "last_unit_price",
            "last_purchased_at",
            "last_counted_qty",
            "last_counted_at",
        )


class SellItemRowSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    selling_price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=ZERO)
    main_stock_item = serializers.IntegerField(required=False, allow_null=True)

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name.")
        return value


class SellItemSerializer(serializers.ModelSerializer):
    main_stock_item = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = SellItem
        fields = ("id", "name", "selling_price", "main_stock_item", "active", "created_at")
