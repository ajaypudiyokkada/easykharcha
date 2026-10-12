from decimal import Decimal

from rest_framework import serializers

from .models import WastageEntry, WastageReason

MIN_QUANTITY = Decimal("0.001")


class WastageCreateSerializer(serializers.Serializer):
    stock_item = serializers.IntegerField()
    quantity = serializers.DecimalField(max_digits=10, decimal_places=3, min_value=MIN_QUANTITY)
    reason = serializers.ChoiceField(choices=WastageReason.choices)
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class WastageEntrySerializer(serializers.ModelSerializer):
    stock_item_name = serializers.CharField(source="stock_item.name", read_only=True)
    unit = serializers.CharField(source="stock_item.unit", read_only=True)
    recorded_by_name = serializers.CharField(source="recorded_by.name", read_only=True)
    # Computed here unconditionally; the view strips this key entirely (not just nulls it) for a
    # role without wastage.view_value — omit, don't just hide, same rule as the blind count form.
    value = serializers.SerializerMethodField()

    class Meta:
        model = WastageEntry
        fields = (
            "id",
            "stock_item",
            "stock_item_name",
            "unit",
            "quantity",
            "reason",
            "note",
            "recorded_by",
            "recorded_by_name",
            "recorded_at",
            "value",
        )

    def get_value(self, obj: WastageEntry) -> str | None:
        if obj.unit_cost_at_entry is None:
            return None
        return str(obj.quantity * obj.unit_cost_at_entry)
