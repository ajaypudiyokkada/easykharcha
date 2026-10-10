from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from core.fields import d
from inventory.models import (
    DailyStock,
    Dish,
    Ingredient,
    Purchase,
    RecipeLine,
    Request,
    Sale,
    SalesImport,
    Vendor,
    Wastage,
    WastageReason,
)


class TenantScopedRelatedField(serializers.PrimaryKeyRelatedField):
    """A FK that can only point at rows belonging to the caller's tenant.

    Non-negotiable #1 again: without this, a Manager at tenant A could post a wastage row referencing
    tenant B's ingredient id and link data across tenants.
    """

    def get_queryset(self):
        queryset = super().get_queryset()
        business = self.context.get("business")
        return queryset.filter(business=business) if business else queryset.none()


class VendorSerializer(serializers.ModelSerializer):
    in_use = serializers.BooleanField(read_only=True)

    class Meta:
        model = Vendor
        fields = (
            "id",
            "code",
            "name",
            "category",
            "contact",
            "phone",
            "terms",
            "gst",
            "notes",
            "in_use",
        )


class IngredientSerializer(serializers.ModelSerializer):
    vendor = TenantScopedRelatedField(
        queryset=Vendor.objects.all(), required=False, allow_null=True
    )
    vendor_name = serializers.CharField(source="vendor.name", read_only=True)
    canonical_code = serializers.CharField(source="canonical.code", read_only=True)
    effective_piece_weight_g = serializers.DecimalField(
        max_digits=8, decimal_places=2, read_only=True
    )

    class Meta:
        model = Ingredient
        fields = (
            "id",
            "code",
            "name",
            "category",
            "unit",
            "rate",
            "vendor",
            "vendor_name",
            "target_pct",
            "waste_alert_pct",
            "shared",
            "track",
            "notes",
            "canonical",
            "canonical_code",
            "piece_weight_g",
            "effective_piece_weight_g",
            "recipe_unit",
            "recipe_units_per_stock_unit",
            "yield_pct",
            "variance_alert_pct",
        )

    def validate(self, attrs):
        shared = attrs.get("shared", getattr(self.instance, "shared", False))
        if shared and self.instance and self.instance.recipe_lines.exists():
            raise serializers.ValidationError(
                {"shared": "Remove this ingredient's recipe lines before marking it shared (§5b)."}
            )
        if shared and self.instance and self.instance.primary_dishes.exists():
            raise serializers.ValidationError(
                {
                    "shared": "Dishes use this as their primary ingredient. A shared ingredient "
                    "cannot be a dish's primary ingredient."
                }
            )
        return attrs


class DishSerializer(serializers.ModelSerializer):
    ing = TenantScopedRelatedField(queryset=Ingredient.objects.all())
    ing_name = serializers.CharField(source="ing.name", read_only=True)
    has_recipe = serializers.BooleanField(read_only=True)

    class Meta:
        model = Dish
        fields = (
            "id",
            "code",
            "name",
            "section",
            "price",
            "ing",
            "ing_name",
            "active",
            "notes",
            "pos_alias",
            "has_recipe",
        )

    def validate_ing(self, value: Ingredient) -> Ingredient:
        if value.shared:
            raise serializers.ValidationError(
                "A dish's primary ingredient cannot be a shared/misc ingredient "
                "(oil, masalas, packaging) — those are pooled across all dishes."
            )
        return value


class RecipeLineSerializer(serializers.ModelSerializer):
    ingredient = TenantScopedRelatedField(queryset=Ingredient.objects.all())
    ingredient_name = serializers.CharField(source="ingredient.name", read_only=True)
    recipe_unit = serializers.CharField(source="ingredient.recipe_unit", read_only=True)
    stock_unit = serializers.CharField(source="ingredient.unit", read_only=True)
    line_cost = serializers.SerializerMethodField()

    class Meta:
        model = RecipeLine
        fields = (
            "id",
            "dish",
            "ingredient",
            "ingredient_name",
            "qty_per_portion",
            "recipe_unit",
            "stock_unit",
            "source_template",
            "confidence",
            "line_cost",
        )
        read_only_fields = ("dish", "source_template")

    def get_line_cost(self, obj: RecipeLine) -> Decimal:
        ingredient = obj.ingredient
        qty = d(obj.qty_per_portion) / d(ingredient.recipe_units_per_stock_unit)
        qty = qty / (d(ingredient.yield_pct) / Decimal("100"))
        return (qty * d(ingredient.rate)).quantize(Decimal("0.01"))

    def validate_ingredient(self, value: Ingredient) -> Ingredient:
        if value.shared:
            raise serializers.ValidationError(
                "Shared ingredients (oil, masalas, packaging) are pooled across dishes and never "
                "given recipe lines — see §5b."
            )
        return value


# ---------------------------------------------------------------------------------------------
# Entry serializers
# ---------------------------------------------------------------------------------------------


class WastageSerializer(serializers.ModelSerializer):
    ingredient = TenantScopedRelatedField(queryset=Ingredient.objects.all())
    ingredient_name = serializers.CharField(source="ingredient.name", read_only=True)
    unit = serializers.CharField(source="ingredient.unit", read_only=True)
    entered_by_name = serializers.SerializerMethodField()
    reason_label = serializers.CharField(source="get_reason_display", read_only=True)

    class Meta:
        model = Wastage
        fields = (
            "id",
            "date",
            "ingredient",
            "ingredient_name",
            "unit",
            "qty",
            "reason",
            "reason_label",
            "note",
            "entered_by",
            "entered_by_name",
            "entered_at",
        )
        read_only_fields = ("entered_by", "entered_at")

    def get_entered_by_name(self, obj) -> str | None:
        return (obj.entered_by.name or obj.entered_by.phone) if obj.entered_by else None

    def validate(self, attrs):
        reason = attrs.get("reason", getattr(self.instance, "reason", None))
        note = attrs.get("note", getattr(self.instance, "note", "") or "")
        if reason == WastageReason.OTHER and not note.strip():
            raise serializers.ValidationError(
                {"note": "Say what happened — 'Other' with no note tells the report nothing."}
            )
        if attrs.get("qty") is not None and attrs["qty"] <= 0:
            raise serializers.ValidationError({"qty": "Quantity must be more than zero."})
        return attrs

    def create(self, validated):
        validated.setdefault("entered_by", self.context["access"].user)
        validated.setdefault("entered_at", timezone.now())
        return super().create(validated)


class DailyStockSerializer(serializers.ModelSerializer):
    """Read serializer for stock rows. Capture goes through StockOpenSerializer/StockCloseSerializer."""

    ingredient_name = serializers.CharField(source="ingredient.name", read_only=True)
    unit = serializers.CharField(source="ingredient.unit", read_only=True)
    opened_by_name = serializers.SerializerMethodField()
    closed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = DailyStock
        fields = (
            "id",
            "date",
            "ingredient",
            "ingredient_name",
            "unit",
            "opening_qty",
            "opened_by",
            "opened_by_name",
            "opened_at",
            "closing_qty",
            "closed_by",
            "closed_by_name",
            "closed_at",
        )

    def get_opened_by_name(self, obj) -> str | None:
        return (obj.opened_by.name or obj.opened_by.phone) if obj.opened_by else None

    def get_closed_by_name(self, obj) -> str | None:
        return (obj.closed_by.name or obj.closed_by.phone) if obj.closed_by else None


class StockCaptureSerializer(serializers.Serializer):
    """Shared shape for opening and closing capture: one ingredient, one date, one quantity."""

    date = serializers.DateField(required=False)
    ingredient = TenantScopedRelatedField(queryset=Ingredient.objects.all())
    qty = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0"))

    def validate_date(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError("You cannot record stock for a future date.")
        return value


class PurchaseSerializer(serializers.ModelSerializer):
    vendor = TenantScopedRelatedField(queryset=Vendor.objects.all())
    ingredient = TenantScopedRelatedField(queryset=Ingredient.objects.all())
    request = TenantScopedRelatedField(
        queryset=Request.objects.all(), required=False, allow_null=True
    )
    vendor_name = serializers.CharField(source="vendor.name", read_only=True)
    ingredient_name = serializers.CharField(source="ingredient.name", read_only=True)
    unit = serializers.CharField(source="ingredient.unit", read_only=True)
    is_short = serializers.BooleanField(read_only=True)
    received_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Purchase
        fields = (
            "id",
            "date",
            "vendor",
            "vendor_name",
            "ingredient",
            "ingredient_name",
            "unit",
            "qty_invoiced",
            "rate",
            "amount",
            "invoice_ref",
            "invoice_image",
            "qty_received",
            "received_by",
            "received_by_name",
            "received_at",
            "request",
            "is_short",
        )
        read_only_fields = ("amount", "received_by", "received_at")

    def get_received_by_name(self, obj) -> str | None:
        return (obj.received_by.name or obj.received_by.phone) if obj.received_by else None

    def validate(self, attrs):
        qty_invoiced = attrs.get("qty_invoiced", getattr(self.instance, "qty_invoiced", None))
        qty_received = attrs.get("qty_received", getattr(self.instance, "qty_received", None))
        if qty_invoiced is not None and qty_invoiced <= 0:
            raise serializers.ValidationError({"qty_invoiced": "Invoiced quantity must be > 0."})
        if qty_received is not None and qty_received > qty_invoiced:
            raise serializers.ValidationError(
                {
                    "qty_received": "More received than invoiced. If the vendor sent extra, raise the "
                    "invoiced quantity too — otherwise the cost is understated."
                }
            )
        request = attrs.get("request")
        ingredient = attrs.get("ingredient", getattr(self.instance, "ingredient", None))
        if request and ingredient and request.ingredient_id != ingredient.id:
            raise serializers.ValidationError(
                {"request": "That request is for a different ingredient."}
            )
        return attrs

    def create(self, validated):
        validated.setdefault("received_by", self.context["access"].user)
        validated.setdefault("received_at", timezone.now())
        return super().create(validated)


class SaleSerializer(serializers.ModelSerializer):
    dish = TenantScopedRelatedField(queryset=Dish.objects.all())
    dish_name = serializers.CharField(source="dish.name", read_only=True)
    entered_by_name = serializers.SerializerMethodField()
    #: Optional on input: it defaults to price × plates in validate(). A Manager entering 20 plates
    #: should not have to do the multiplication, but must still be able to override it for a discount.
    revenue = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )

    class Meta:
        model = Sale
        fields = (
            "id",
            "date",
            "dish",
            "dish_name",
            "plates",
            "revenue",
            "entered_by",
            "entered_by_name",
            "entered_at",
            "source",
            "import_batch",
        )
        read_only_fields = ("entered_by", "entered_at", "source", "import_batch")

    def get_entered_by_name(self, obj) -> str | None:
        return (obj.entered_by.name or obj.entered_by.phone) if obj.entered_by else None

    def validate_date(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError("You cannot record sales for a future date.")
        return value

    def validate(self, attrs):
        # Revenue defaults to price × plates but stays editable, so a discount or a comp is recorded
        # as what actually came in rather than what the menu says.
        if attrs.get("revenue") is None:
            dish = attrs.get("dish") or getattr(self.instance, "dish", None)
            plates = attrs.get("plates", getattr(self.instance, "plates", None))
            if dish is None or plates is None:
                raise serializers.ValidationError(
                    {
                        "revenue": "Give a revenue figure, or a dish and plate count to compute it from."
                    }
                )
            attrs["revenue"] = d(dish.price) * plates
        return attrs

    def create(self, validated):
        validated.setdefault("entered_by", self.context["access"].user)
        validated.setdefault("entered_at", timezone.now())
        return super().create(validated)


class RequestSerializer(serializers.ModelSerializer):
    ingredient = TenantScopedRelatedField(queryset=Ingredient.objects.all())
    ingredient_name = serializers.CharField(source="ingredient.name", read_only=True)
    unit = serializers.CharField(source="ingredient.unit", read_only=True)
    requested_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Request
        fields = (
            "id",
            "date",
            "ingredient",
            "ingredient_name",
            "unit",
            "qty",
            "note",
            "requested_by",
            "requested_by_name",
            "status",
            "fulfilled_purchase",
        )
        read_only_fields = ("requested_by", "status", "fulfilled_purchase")

    def get_requested_by_name(self, obj) -> str | None:
        return (obj.requested_by.name or obj.requested_by.phone) if obj.requested_by else None

    def create(self, validated):
        validated.setdefault("requested_by", self.context["access"].user)
        validated.setdefault("date", timezone.localdate())
        return super().create(validated)


class SalesImportSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = SalesImport
        fields = (
            "id",
            "filename",
            "uploaded_by",
            "uploaded_by_name",
            "uploaded_at",
            "date_from",
            "date_to",
            "rows_total",
            "rows_matched",
            "rows_unmatched",
        )

    def get_uploaded_by_name(self, obj) -> str | None:
        return (obj.uploaded_by.name or obj.uploaded_by.phone) if obj.uploaded_by else None
