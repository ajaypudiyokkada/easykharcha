from decimal import Decimal

from rest_framework import serializers

from .models import Purchase, PurchaseLine

ZERO = Decimal("0")
MIN_QUANTITY = Decimal("0.001")
# "Within Rs 1" of quantity x unit_price — covers ordinary rounding without silently accepting a
# typo'd total.
LINE_TOTAL_TOLERANCE = Decimal("1.00")


class PurchaseLineRowSerializer(serializers.Serializer):
    """One line of a purchase. Only format/range checks here — that the stock item actually belongs
    to this business is a cross-row, DB-backed check the view does, same split as stock's bulk-create
    row serializers."""

    stock_item = serializers.IntegerField()
    quantity = serializers.DecimalField(max_digits=10, decimal_places=3, min_value=MIN_QUANTITY)
    # Step U1b-1: widened 2dp->4dp, max_digits 10->12, matching PurchaseLine.unit_price.
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=4, min_value=ZERO)
    line_total = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=ZERO)

    def validate(self, attrs: dict) -> dict:
        expected = (attrs["quantity"] * attrs["unit_price"]).quantize(Decimal("0.01"))
        if abs(attrs["line_total"] - expected) > LINE_TOTAL_TOLERANCE:
            raise serializers.ValidationError(
                {"line_total": "Doesn't match quantity x price per unit."}
            )
        return attrs


class PurchaseCreateSerializer(serializers.Serializer):
    """The purchase-level fields — lines are validated separately (see PurchaseLineRowSerializer)
    since they need per-row error numbering, not a single serializer error."""

    supplier_name = serializers.CharField(
        max_length=120, required=False, allow_blank=True, default=""
    )
    purchase_date_time = serializers.DateTimeField()
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")

    def validate_supplier_name(self, value: str) -> str:
        return value.strip()


class PurchaseLineSerializer(serializers.ModelSerializer):
    stock_item_name = serializers.CharField(source="stock_item.name", read_only=True)
    unit = serializers.CharField(source="stock_item.unit", read_only=True)

    class Meta:
        model = PurchaseLine
        fields = (
            "id",
            "stock_item",
            "stock_item_name",
            "unit",
            "quantity",
            "unit_price",
            "line_total",
        )


class PurchaseSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default=None)
    recorded_by_name = serializers.CharField(source="recorded_by.name", read_only=True)
    lines = PurchaseLineSerializer(many=True, read_only=True)

    class Meta:
        model = Purchase
        fields = (
            "id",
            "supplier",
            "supplier_name",
            "purchase_date_time",
            "total_amount",
            "note",
            "recorded_by",
            "recorded_by_name",
            "created_at",
            "updated_at",
            "lines",
        )
