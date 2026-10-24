from decimal import Decimal

from rest_framework import serializers

from stock.units import display_price_per_major_unit, display_quantity

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
    # Step U1b-2: what unit `quantity`/`unit_price` were typed in ("kg", "packet", ...) — None means
    # the item's own base unit, the pre-U1b-2 behaviour. The view converts both down to the stock
    # item's base unit once it's resolved `stock_item` (see stock/units.py's convert_entry_*);
    # never stored itself, so it's popped from the cleaned row before the model is built.
    entry_unit = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None
    )

    def validate(self, attrs: dict) -> dict:
        # The quantity/price-per-unit/total relationship holds regardless of which unit they were
        # typed in (the unit cancels out of quantity x price), so this check runs on the raw typed
        # values, before any base-unit conversion.
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
    # Step U1b-2: `quantity` stays the stored base-unit figure; these are the rolled-up owner-facing
    # versions (3,200 g -> "3.2"/"kg"; 999 g -> "999"/"g") and the per-kg/L price.
    display_quantity = serializers.SerializerMethodField()
    display_unit = serializers.SerializerMethodField()
    unit_price_per_major_unit = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseLine
        fields = (
            "id",
            "stock_item",
            "stock_item_name",
            "unit",
            "quantity",
            "display_quantity",
            "display_unit",
            "unit_price",
            "unit_price_per_major_unit",
            "line_total",
        )

    def get_display_quantity(self, obj: PurchaseLine) -> str:
        value, _ = display_quantity(obj.quantity, obj.stock_item.unit)
        return str(value)

    def get_display_unit(self, obj: PurchaseLine) -> str:
        _, unit = display_quantity(obj.quantity, obj.stock_item.unit)
        return unit

    def get_unit_price_per_major_unit(self, obj: PurchaseLine) -> str:
        return str(display_price_per_major_unit(obj.unit_price, obj.stock_item.unit))


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
