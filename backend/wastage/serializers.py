from decimal import Decimal

from rest_framework import serializers

from stock.units import display_price_per_major_unit, display_quantity

from .models import WastageEntry, WastageReason

MIN_QUANTITY = Decimal("0.001")


class WastageCreateSerializer(serializers.Serializer):
    stock_item = serializers.IntegerField()
    quantity = serializers.DecimalField(max_digits=10, decimal_places=3, min_value=MIN_QUANTITY)
    reason = serializers.ChoiceField(choices=WastageReason.choices)
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    # Step U1b-2: what unit `quantity` was typed in — None means the item's own base unit. The view
    # converts it once the stock item is resolved (see stock/units.py's convert_entry_quantity).
    entry_unit = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None
    )


class WastageEntrySerializer(serializers.ModelSerializer):
    stock_item_name = serializers.CharField(source="stock_item.name", read_only=True)
    unit = serializers.CharField(source="stock_item.unit", read_only=True)
    recorded_by_name = serializers.CharField(source="recorded_by.name", read_only=True)
    # Computed here unconditionally; the view strips this key entirely (not just nulls it) for a
    # role without wastage.view_value — omit, don't just hide, same rule as the blind count form.
    value = serializers.SerializerMethodField()
    # Step U1b-2: `quantity` stays the stored base-unit figure; these roll it up for display.
    display_quantity = serializers.SerializerMethodField()
    display_unit = serializers.SerializerMethodField()
    unit_cost_at_entry_per_major_unit = serializers.SerializerMethodField()

    class Meta:
        model = WastageEntry
        fields = (
            "id",
            "stock_item",
            "stock_item_name",
            "unit",
            "quantity",
            "display_quantity",
            "display_unit",
            "reason",
            "note",
            "recorded_by",
            "recorded_by_name",
            "recorded_at",
            "value",
            "unit_cost_at_entry_per_major_unit",
        )

    def get_value(self, obj: WastageEntry) -> str | None:
        if obj.unit_cost_at_entry is None:
            return None
        return str(obj.quantity * obj.unit_cost_at_entry)

    def get_display_quantity(self, obj: WastageEntry) -> str:
        value, _ = display_quantity(obj.quantity, obj.stock_item.unit)
        return str(value)

    def get_display_unit(self, obj: WastageEntry) -> str:
        _, unit = display_quantity(obj.quantity, obj.stock_item.unit)
        return unit

    def get_unit_cost_at_entry_per_major_unit(self, obj: WastageEntry) -> str | None:
        price = display_price_per_major_unit(obj.unit_cost_at_entry, obj.stock_item.unit)
        return str(price) if price is not None else None
