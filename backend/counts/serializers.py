from decimal import Decimal

from rest_framework import serializers

from .models import CountLineState, CountType, StockCount

ZERO = Decimal("0")


class CountLineRowSerializer(serializers.Serializer):
    """One line of a count submission. Only format checks here — that the stock item actually
    belongs to this business, and the unusual-value guard, are cross-row/DB-backed checks the view
    does, same split as purchases' and stock's bulk row serializers."""

    stock_item = serializers.IntegerField()
    state = serializers.ChoiceField(choices=CountLineState.choices)
    counted_qty = serializers.DecimalField(
        max_digits=10, decimal_places=3, required=False, allow_null=True, min_value=ZERO
    )
    # Step U1b-2: what unit `counted_qty` was typed in — None means the item's own base unit. The
    # view converts it once the stock item is resolved (see stock/units.py's convert_entry_quantity).
    entry_unit = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None
    )

    def validate(self, attrs: dict) -> dict:
        if attrs["state"] == CountLineState.SKIPPED:
            attrs["counted_qty"] = None
        elif attrs["state"] in (CountLineState.COUNTED,) and attrs.get("counted_qty") is None:
            raise serializers.ValidationError(
                {"counted_qty": "Enter a quantity, mark it Not sure, or skip this item."}
            )
        return attrs


class CountCreateSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=CountType.choices)
    confirm_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, default=list
    )


class StockCountSerializer(serializers.ModelSerializer):
    counted_by_name = serializers.CharField(source="counted_by.name", read_only=True)

    class Meta:
        model = StockCount
        fields = (
            "id",
            "count_type",
            "business_date",
            "counted_by",
            "counted_by_name",
            "submitted_at",
            "deadline_at",
            "is_late",
            "minutes_late",
            "missing_opening",
        )
