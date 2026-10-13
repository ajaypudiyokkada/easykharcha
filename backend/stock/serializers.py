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


class StockItemUpdateSerializer(serializers.Serializer):
    """PATCH stock-items/<id>/ — every field optional (partial update). Only format/range checks
    here; name-uniqueness, the unit lock, and the in-use check all need a query, so the view does
    those — same split as StockItemRowSerializer above."""

    name = serializers.CharField(max_length=120, required=False)
    unit = serializers.ChoiceField(choices=Unit.choices, required=False)
    usual_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True, min_value=ZERO
    )
    supplier = serializers.CharField(max_length=120, required=False, allow_blank=True)
    shared = serializers.BooleanField(required=False)
    goes_off = serializers.BooleanField(required=False)
    shelf_life_days = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    active = serializers.BooleanField(required=False)

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name.")
        return value

    def validate(self, attrs: dict) -> dict:
        # Only clears shelf_life_days when goes_off is explicitly turned off in this request — a
        # PATCH that doesn't mention goes_off at all (e.g. just renaming) must leave it alone.
        if "goes_off" in attrs and not attrs["goes_off"]:
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
    # How much of main_stock_item one unit sold uses — only meaningful alongside main_stock_item;
    # the view rejects it on its own, since that check needs to know whether a stock item ended up
    # linked at all, which only the view can resolve.
    uses_qty = serializers.DecimalField(
        max_digits=10, decimal_places=3, required=False, allow_null=True, min_value=ZERO
    )

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name.")
        return value


class SellItemUpdateSerializer(serializers.Serializer):
    """PATCH sell-items/<id>/ — every field optional (partial update). Cross-field checks (the
    stock item must belong to this business and not be shared, uses_qty needs a main stock item)
    need the resolved stock item, so the view does those."""

    name = serializers.CharField(max_length=120, required=False)
    selling_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, min_value=ZERO
    )
    main_stock_item = serializers.IntegerField(required=False, allow_null=True)
    uses_qty = serializers.DecimalField(
        max_digits=10, decimal_places=3, required=False, allow_null=True, min_value=ZERO
    )
    active = serializers.BooleanField(required=False)

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name.")
        return value


class SellItemSerializer(serializers.ModelSerializer):
    main_stock_item = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = SellItem
        fields = (
            "id",
            "name",
            "selling_price",
            "main_stock_item",
            "uses_qty",
            "active",
            "created_at",
        )
