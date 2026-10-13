from decimal import Decimal

from rest_framework import serializers

from .models import Sale

ZERO = Decimal("0")
MIN_QUANTITY = Decimal("0.001")


class SaleLineRowSerializer(serializers.Serializer):
    """One line of a sales submission. Only format/range checks here — that the sell item actually
    belongs to this business and is active is a cross-row, DB-backed check the view does, same split
    as purchases' and counts' row serializers. `amount` is optional: the view fills in
    quantity x selling price when it's left out."""

    sell_item = serializers.IntegerField()
    quantity = serializers.DecimalField(max_digits=10, decimal_places=3, min_value=MIN_QUANTITY)
    amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True, min_value=ZERO
    )


class SaleCreateSerializer(serializers.Serializer):
    business_date = serializers.DateField()


class SaleSerializer(serializers.ModelSerializer):
    sell_item_name = serializers.CharField(source="sell_item.name", read_only=True)
    recorded_by_name = serializers.CharField(source="recorded_by.name", read_only=True)

    class Meta:
        model = Sale
        fields = (
            "id",
            "sell_item",
            "sell_item_name",
            "business_date",
            "quantity",
            "amount",
            "source",
            "recorded_by",
            "recorded_by_name",
            "created_at",
        )
