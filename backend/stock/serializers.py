from decimal import Decimal

from rest_framework import serializers

from counts.models import CountLine
from purchases.models import PurchaseLine
from wastage.models import WastageEntry

from .models import (
    BASE_UNIT_FAMILY_CHOICES,
    Base,
    BaseIngredient,
    LowStockCategory,
    SellItem,
    SellItemBase,
    SellItemIngredient,
    StockItem,
    Unit,
)
from .units import (
    BASE_UNIT_FOR_FAMILY,
    base_unit_for,
    display_price_per_major_unit,
    display_quantity,
)
from .units import unit_family as _unit_family_for

ZERO = Decimal("0")
# An ingredient quantity states "one portion uses this much of the stock item" — 0 isn't a
# meaningful answer to that, so a provided value must be a real positive amount.
MIN_POSITIVE_QTY = Decimal("0.001")
MAX_INGREDIENT_QTY = Decimal("100000")
MIN_POSITIVE_PACK_SIZE = Decimal("0.001")
MIN_POSITIVE_YIELD = Decimal("0.001")


def _clean_group(value: str) -> str:
    return value.strip()


def _resolve_unit_and_family(attrs: dict) -> None:
    """Step U1b-2: the `unit` an owner picks at create/edit time is an entry unit (kg, g, L, ml, or
    any of the plain count labels) — this derives the family it belongs to and rewrites `unit` to
    the base it actually stores as (g/ml for weight/volume; unchanged for count), same rule
    docs/UNIT_REDESIGN.md's "Stock-item creation" section describes."""
    if "unit" not in attrs:
        return
    entry_unit = attrs["unit"]
    attrs["unit_family"] = _unit_family_for(entry_unit)
    attrs["unit"] = base_unit_for(entry_unit)


class StockItemRowSerializer(serializers.Serializer):
    """One row of a bulk stock-items create. Only format/range checks here — name-uniqueness and
    cross-row checks need the whole batch, so the view does those."""

    name = serializers.CharField(max_length=120)
    unit = serializers.ChoiceField(choices=Unit.choices)
    pack_size_base_qty = serializers.DecimalField(
        max_digits=10,
        decimal_places=3,
        required=False,
        allow_null=True,
        min_value=MIN_POSITIVE_PACK_SIZE,
    )
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
        _resolve_unit_and_family(attrs)
        return attrs


class StockItemUpdateSerializer(serializers.Serializer):
    """PATCH stock-items/<id>/ — every field optional (partial update). Only format/range checks
    here; name-uniqueness, the unit lock, and the in-use check all need a query, so the view does
    those — same split as StockItemRowSerializer above."""

    name = serializers.CharField(max_length=120, required=False)
    unit = serializers.ChoiceField(choices=Unit.choices, required=False)
    # Step U1b-2: never locked by history, unlike `unit`/`unit_family` (Decision 3, U1b-1 report) —
    # correcting a pack's real-world size can't rescale anything already recorded in base units.
    pack_size_base_qty = serializers.DecimalField(
        max_digits=10,
        decimal_places=3,
        required=False,
        allow_null=True,
        min_value=MIN_POSITIVE_PACK_SIZE,
    )
    usual_price = serializers.DecimalField(
        max_digits=12, decimal_places=4, required=False, allow_null=True, min_value=ZERO
    )
    supplier = serializers.CharField(max_length=120, required=False, allow_blank=True)
    shared = serializers.BooleanField(required=False)
    goes_off = serializers.BooleanField(required=False)
    shelf_life_days = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    group = serializers.CharField(max_length=40, required=False, allow_blank=True)
    active = serializers.BooleanField(required=False)
    # Step 41b1b3a: low-stock threshold inputs — gated on "stockitems.thresholds_manage" in the
    # view, separately from the rest of this serializer's fields ("stockitems.manage"), so a
    # Manager (who has the former but not the latter) can PATCH these without also being able to
    # rename/deactivate the item.
    low_stock_category = serializers.ChoiceField(choices=LowStockCategory.choices, required=False)
    low_stock_days_override = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    low_stock_fixed_qty = serializers.DecimalField(
        max_digits=10, decimal_places=3, required=False, allow_null=True, min_value=ZERO
    )

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
        _resolve_unit_and_family(attrs)
        return attrs


class StockItemSerializer(serializers.ModelSerializer):
    # Populated via annotation (see StockItemListView/StockItemDetailView) from this item's purchase
    # history — plain declared fields here just expose whatever the queryset already computed, same
    # as any other read-only field. None for an item that's never been bought yet.
    last_unit_price = serializers.DecimalField(
        max_digits=12, decimal_places=4, read_only=True, default=None
    )
    # Step U1b-3a: `last_unit_price` stays the stored per-base-unit figure (now per g/ml, since
    # purchases can be typed in kg/L and converted down) — this is the owner-facing "last paid",
    # always per kg/L for a weight/volume item, same rollup as `usual_price_per_major_unit`.
    last_unit_price_per_major_unit = serializers.SerializerMethodField()
    last_purchased_at = serializers.DateTimeField(read_only=True, default=None)
    # Step 10: populated via annotation too (see _with_last_count_info). Deliberately no "on hand"
    # or gap field — that needs usage math this step doesn't build yet.
    last_counted_qty = serializers.DecimalField(
        max_digits=10, decimal_places=3, read_only=True, default=None
    )
    last_counted_at = serializers.DateTimeField(read_only=True, default=None)

    # Step U1b-2: the owner-facing price, always per kg/L for a weight/volume item — `usual_price`
    # itself stays the stored per-base-unit figure (see StockItem.usual_price's comment).
    usual_price_per_major_unit = serializers.SerializerMethodField()
    # Step U1b-3b-1: mirrors the PATCH view's own has_history check (same four tables) so the edit
    # form can show the lock message up front instead of only after a rejected save.
    unit_locked = serializers.SerializerMethodField()

    class Meta:
        model = StockItem
        fields = (
            "id",
            "name",
            "unit",
            "unit_family",
            "pack_size_base_qty",
            "unit_locked",
            "usual_price",
            "usual_price_per_major_unit",
            "supplier",
            "shared",
            "goes_off",
            "shelf_life_days",
            "group",
            "low_stock_category",
            "low_stock_days_override",
            "low_stock_fixed_qty",
            "active",
            "created_at",
            "last_unit_price",
            "last_unit_price_per_major_unit",
            "last_purchased_at",
            "last_counted_qty",
            "last_counted_at",
        )

    def get_unit_locked(self, obj: StockItem) -> bool:
        return (
            PurchaseLine.objects.filter(stock_item=obj).exists()
            or CountLine.objects.filter(stock_item=obj).exists()
            or WastageEntry.objects.filter(stock_item=obj).exists()
            or SellItemIngredient.objects.filter(stock_item=obj).exists()
        )

    def get_usual_price_per_major_unit(self, obj: StockItem) -> str | None:
        price = display_price_per_major_unit(obj.usual_price, obj.unit)
        return str(price) if price is not None else None

    def get_last_unit_price_per_major_unit(self, obj: StockItem) -> str | None:
        # `last_unit_price` only exists on instances fetched through _with_last_purchase_info's
        # annotation (list/detail views) — absent on a freshly created/updated instance (bulk
        # create, PATCH), same as the declared `last_unit_price` field's own default=None covers.
        last_unit_price = getattr(obj, "last_unit_price", None)
        price = display_price_per_major_unit(last_unit_price, obj.unit)
        return str(price) if price is not None else None


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
    """One ingredient row of a dish. Step U1b-2: `quantity` may be typed in any entry unit this
    stock item accepts (see stock/units.py's entry_units_for) — `entry_unit` None means the item's
    own base unit, the pre-U1b-2 behaviour (the client used to convert g/ml itself before sending,
    see mobile/src/forms/unitConversion.ts; the view now does it once `stock_item` is resolved)."""

    stock_item = serializers.IntegerField()
    quantity = serializers.DecimalField(
        max_digits=10,
        decimal_places=3,
        min_value=MIN_POSITIVE_QTY,
        max_value=MAX_INGREDIENT_QTY,
    )
    entry_unit = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None
    )


def _validate_ingredient_rows(rows: list[dict], required: bool = True) -> list[dict]:
    """Step 42b1c1: `required` is False wherever a dish's `bases` can satisfy the "at least one
    real line" rule instead — the view checks the ingredients+bases total once both are resolved,
    since a serializer validating one field alone can't see the other."""
    if not rows and required:
        raise serializers.ValidationError("Add at least one ingredient.")
    seen_stock_item_ids: set[int] = set()
    for row in rows:
        if row["stock_item"] in seen_stock_item_ids:
            raise serializers.ValidationError("Each ingredient can only be used once in a dish.")
        seen_stock_item_ids.add(row["stock_item"])
    return rows


class BaseUsageRowSerializer(serializers.Serializer):
    """One row of a dish's optional `bases` array — parallel to IngredientRowSerializer, with no
    entry-unit conversion (a base's own batch unit is always already g/ml)."""

    base = serializers.IntegerField()
    quantity = serializers.DecimalField(
        max_digits=10, decimal_places=3, min_value=MIN_POSITIVE_QTY, max_value=MAX_INGREDIENT_QTY
    )


class BaseUsageLinkRowSerializer(serializers.Serializer):
    """One row of a base's own "Used in" full-replace list — the mirror image of
    BaseUsageRowSerializer, keyed by dish instead of by base (see BaseUsedInView)."""

    sell_item = serializers.IntegerField()
    quantity = serializers.DecimalField(
        max_digits=10, decimal_places=3, min_value=MIN_POSITIVE_QTY, max_value=MAX_INGREDIENT_QTY
    )


def _validate_base_rows(rows: list[dict]) -> list[dict]:
    seen_base_ids: set[int] = set()
    for row in rows:
        if row["base"] in seen_base_ids:
            raise serializers.ValidationError("Each base can only be used once in a dish.")
        seen_base_ids.add(row["base"])
    return rows


class SellItemCreateSerializer(serializers.Serializer):
    """POST sell-items/ — the manual dish form's single-item create, with its full recipe (Step
    22a; Step 42b1c1 added `bases`). The view resolves `ingredients[].stock_item`/`bases[].base`
    against this business's own rows; a dish can't be saved without at least one valid ingredient
    or base line between the two, so this always lands at recipe_status=confirmed."""

    name = serializers.CharField(max_length=120)
    selling_price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=ZERO)
    portion_label = serializers.CharField(
        max_length=40, required=False, allow_blank=True, default=""
    )
    group = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    ingredients = IngredientRowSerializer(many=True, required=False, default=list)
    bases = BaseUsageRowSerializer(many=True, required=False, default=list)

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
        return _validate_ingredient_rows(value, required=False)

    def validate_bases(self, value: list[dict]) -> list[dict]:
        return _validate_base_rows(value)

    def validate(self, attrs: dict) -> dict:
        if not attrs.get("ingredients") and not attrs.get("bases"):
            raise serializers.ValidationError(
                {"ingredients": "Add at least one ingredient or a base."}
            )
        return attrs


class SellItemUpdateSerializer(serializers.Serializer):
    """PATCH sell-items/<id>/ — every field optional (partial update). `ingredients`/`bases`, when
    either is present, fully replaces that dish's rows of that kind under the same rule as create
    (no duplicates) and re-confirms the recipe — editing a dish still goes through the same form.
    Cross-field checks that need a query (stock items/bases must belong to this business, stock
    items not shared) are the view's job, same split as StockItemUpdateSerializer."""

    name = serializers.CharField(max_length=120, required=False)
    selling_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, min_value=ZERO
    )
    portion_label = serializers.CharField(max_length=40, required=False, allow_blank=True)
    group = serializers.CharField(max_length=40, required=False, allow_blank=True)
    ingredients = IngredientRowSerializer(many=True, required=False)
    bases = BaseUsageRowSerializer(many=True, required=False)
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
        return _validate_ingredient_rows(value, required=False)

    def validate_bases(self, value: list[dict]) -> list[dict]:
        return _validate_base_rows(value)


# Step 41b1b3a: the fields of StockItemUpdateSerializer gated on "stockitems.thresholds_manage"
# rather than "stockitems.manage" — shared with stock/views.py's StockItemDetailView.patch so the
# two never drift apart.
LOW_STOCK_THRESHOLD_FIELDS = frozenset(
    {"low_stock_category", "low_stock_days_override", "low_stock_fixed_qty"}
)


class SellItemIngredientSerializer(serializers.ModelSerializer):
    stock_item_name = serializers.CharField(source="stock_item.name", read_only=True)
    unit = serializers.CharField(source="stock_item.unit", read_only=True)
    display_quantity = serializers.SerializerMethodField()
    display_unit = serializers.SerializerMethodField()

    class Meta:
        model = SellItemIngredient
        fields = (
            "id",
            "stock_item",
            "stock_item_name",
            "unit",
            "quantity",
            "display_quantity",
            "display_unit",
        )

    def get_display_quantity(self, obj: SellItemIngredient) -> str:
        value, _ = display_quantity(obj.quantity, obj.stock_item.unit)
        return str(value)

    def get_display_unit(self, obj: SellItemIngredient) -> str:
        _, unit = display_quantity(obj.quantity, obj.stock_item.unit)
        return unit


class SellItemBaseSerializer(serializers.ModelSerializer):
    """One base a dish uses — grams/ml per portion, in the base's own batch unit (already g/ml,
    see Base.unit_family), rolled up for display the same way a raw ingredient is."""

    base_name = serializers.CharField(source="base.name", read_only=True)
    unit = serializers.SerializerMethodField()
    display_quantity = serializers.SerializerMethodField()
    display_unit = serializers.SerializerMethodField()

    class Meta:
        model = SellItemBase
        fields = ("id", "base", "base_name", "unit", "quantity", "display_quantity", "display_unit")

    def get_unit(self, obj: SellItemBase) -> str:
        return BASE_UNIT_FOR_FAMILY[obj.base.unit_family]

    def get_display_quantity(self, obj: SellItemBase) -> str:
        value, _ = display_quantity(obj.quantity, self.get_unit(obj))
        return str(value)

    def get_display_unit(self, obj: SellItemBase) -> str:
        _, unit = display_quantity(obj.quantity, self.get_unit(obj))
        return unit


class SellItemSerializer(serializers.ModelSerializer):
    ingredients = SellItemIngredientSerializer(many=True, read_only=True)
    bases = SellItemBaseSerializer(many=True, read_only=True)

    class Meta:
        model = SellItem
        fields = (
            "id",
            "name",
            "selling_price",
            "portion_label",
            "recipe_status",
            "ingredients",
            "bases",
            "group",
            "active",
            "created_at",
        )


class BaseIngredientRowSerializer(serializers.Serializer):
    """One raw line of a base's batch formula — `quantity` is per the base's own `batch_yield_qty`
    (default 1,000 g/ml), already in the stock item's base unit (no entry-unit conversion, same as
    a dish's direct ingredient rows always being pre-converted by the time they're resolved)."""

    stock_item = serializers.IntegerField()
    quantity = serializers.DecimalField(
        max_digits=10, decimal_places=3, min_value=MIN_POSITIVE_QTY, max_value=MAX_INGREDIENT_QTY
    )


def _validate_base_ingredient_rows(rows: list[dict]) -> list[dict]:
    if not rows:
        raise serializers.ValidationError("Add at least one ingredient.")
    seen_stock_item_ids: set[int] = set()
    for row in rows:
        if row["stock_item"] in seen_stock_item_ids:
            raise serializers.ValidationError("Each ingredient can only be used once in a base.")
        seen_stock_item_ids.add(row["stock_item"])
    return rows


class BaseCreateSerializer(serializers.Serializer):
    """POST bases/ — a base's full batch formula, created in one call (mirrors
    SellItemCreateSerializer's shape)."""

    name = serializers.CharField(max_length=120)
    unit_family = serializers.ChoiceField(choices=BASE_UNIT_FAMILY_CHOICES)
    batch_yield_qty = serializers.DecimalField(
        max_digits=10,
        decimal_places=3,
        required=False,
        default=Decimal("1000"),
        min_value=MIN_POSITIVE_YIELD,
    )
    ingredients = BaseIngredientRowSerializer(many=True)

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name.")
        return value

    def validate_ingredients(self, value: list[dict]) -> list[dict]:
        return _validate_base_ingredient_rows(value)


class BaseUpdateSerializer(serializers.Serializer):
    """PATCH bases/<id>/ — every field optional; `ingredients`, when present, fully replaces the
    batch formula (same full-replace rule as a dish's own ingredients)."""

    name = serializers.CharField(max_length=120, required=False)
    batch_yield_qty = serializers.DecimalField(
        max_digits=10, decimal_places=3, required=False, min_value=MIN_POSITIVE_YIELD
    )
    ingredients = BaseIngredientRowSerializer(many=True, required=False)
    active = serializers.BooleanField(required=False)

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name.")
        return value

    def validate_ingredients(self, value: list[dict]) -> list[dict]:
        return _validate_base_ingredient_rows(value)


class BaseIngredientSerializer(serializers.ModelSerializer):
    stock_item_name = serializers.CharField(source="stock_item.name", read_only=True)
    display_quantity = serializers.SerializerMethodField()
    display_unit = serializers.SerializerMethodField()

    class Meta:
        model = BaseIngredient
        fields = (
            "id",
            "stock_item",
            "stock_item_name",
            "quantity_per_1000",
            "display_quantity",
            "display_unit",
        )

    def _unit(self, obj: BaseIngredient) -> str:
        return BASE_UNIT_FOR_FAMILY[obj.base.unit_family]

    def get_display_quantity(self, obj: BaseIngredient) -> str:
        value, _ = display_quantity(obj.quantity_per_1000, self._unit(obj))
        return str(value)

    def get_display_unit(self, obj: BaseIngredient) -> str:
        _, unit = display_quantity(obj.quantity_per_1000, self._unit(obj))
        return unit


class BaseUsedInDishSerializer(serializers.ModelSerializer):
    sell_item_name = serializers.CharField(source="sell_item.name", read_only=True)

    class Meta:
        model = SellItemBase
        fields = ("id", "sell_item", "sell_item_name", "quantity")


class BaseSerializer(serializers.ModelSerializer):
    ingredients = BaseIngredientSerializer(many=True, read_only=True)
    used_in = BaseUsedInDishSerializer(many=True, read_only=True)
    unit = serializers.SerializerMethodField()

    class Meta:
        model = Base
        fields = (
            "id",
            "name",
            "unit_family",
            "unit",
            "batch_yield_qty",
            "ingredients",
            "used_in",
            "active",
            "created_at",
        )

    def get_unit(self, obj: Base) -> str:
        return BASE_UNIT_FOR_FAMILY[obj.unit_family]
