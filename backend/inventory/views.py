from datetime import timedelta

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from audit.services import record_delete, record_update
from core.exceptions import BusinessRuleError
from core.roles import Capability
from core.viewsets import TenantAPIView, TenantScopedViewSet
from inventory import services
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
from inventory.serializers import (
    DailyStockSerializer,
    DishSerializer,
    IngredientSerializer,
    PurchaseSerializer,
    RecipeLineSerializer,
    RequestSerializer,
    SaleSerializer,
    SalesImportSerializer,
    StockCaptureSerializer,
    VendorSerializer,
    WastageSerializer,
)


def _parse_date(request, key="date"):
    raw = request.data.get(key) or request.query_params.get(key)
    if not raw:
        return None
    from django.utils.dateparse import parse_date

    parsed = parse_date(str(raw))
    if parsed is None:
        raise BusinessRuleError(f"{key} must be YYYY-MM-DD.", code="bad_date")
    return parsed


# ---------------------------------------------------------------------------------------------
# Config: vendors, ingredients, dishes, recipe lines
# ---------------------------------------------------------------------------------------------


class VendorViewSet(TenantScopedViewSet):
    queryset = Vendor.objects.all()
    serializer_class = VendorSerializer
    audit_name = "vendor"
    create_capability = Capability.CONFIG_ADD
    write_capability = Capability.CONFIG_EDIT
    filterset_fields = ["category"]

    def perform_destroy(self, instance):
        if instance.in_use:
            raise BusinessRuleError(
                f"{instance.name} is referenced by purchases or ingredients and cannot be deleted. "
                "Rename it or leave it in place — deleting would orphan past costs.",
                code="vendor_in_use",
            )
        super().perform_destroy(instance)


class IngredientViewSet(TenantScopedViewSet):
    queryset = Ingredient.objects.select_related("vendor", "canonical").all()
    serializer_class = IngredientSerializer
    audit_name = "ingredient"
    create_capability = Capability.CONFIG_ADD
    write_capability = Capability.CONFIG_EDIT
    filterset_fields = ["category", "shared", "track"]

    def perform_destroy(self, instance):
        if instance.primary_dishes.exists():
            raise BusinessRuleError(
                f"{instance.name} is the primary ingredient of "
                f"{instance.primary_dishes.count()} dish(es). Repoint those dishes first.",
                code="ingredient_in_use",
            )
        super().perform_destroy(instance)


class DishViewSet(TenantScopedViewSet):
    queryset = Dish.objects.select_related("ing").all()
    serializer_class = DishSerializer
    audit_name = "dish"
    create_capability = Capability.CONFIG_ADD
    write_capability = Capability.CONFIG_EDIT
    filterset_fields = ["section", "active"]
    lookup_field = "pk"

    @action(detail=True, methods=["get", "post"], url_path="recipe")
    def recipe(self, request, *args, **kwargs):
        """GET the dish's recipe lines; POST adds one. Adding is Manager+, editing is Owner+ (§5b)."""
        dish = self.get_object()
        if request.method == "GET":
            lines = dish.recipe_lines.select_related("ingredient").all()
            return Response(
                {
                    "dish": DishSerializer(dish, context=self.get_serializer_context()).data,
                    "lines": RecipeLineSerializer(
                        lines, many=True, context=self.get_serializer_context()
                    ).data,
                    "standard_cost_per_plate": self._standard_cost(dish),
                }
            )

        if not self.access.can(Capability.CONFIG_ADD):
            raise BusinessRuleError("You cannot add recipe lines.", code="forbidden")
        serializer = RecipeLineSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        line = serializer.save(dish=dish)
        from audit.services import record_create

        record_create(self.access, "recipe_line", line)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def _standard_cost(self, dish):
        from reports.services import standard_cost_per_plate

        lines = list(dish.recipe_lines.select_related("ingredient").all())
        if not lines:
            return None
        # Uses standard rates (no date range here), which is what the recipe editor should show.
        return standard_cost_per_plate(lines, {})


class RecipeLineViewSet(TenantScopedViewSet):
    """Edit/delete of individual recipe lines — Owner/SA only, like every other config edit."""

    queryset = RecipeLine.objects.select_related("ingredient", "dish").all()
    serializer_class = RecipeLineSerializer
    audit_name = "recipe_line"
    create_capability = Capability.CONFIG_ADD
    write_capability = Capability.CONFIG_EDIT
    http_method_names = ["get", "patch", "put", "delete", "head", "options"]

    def get_queryset(self):
        # RecipeLine has no business FK of its own; the dish carries the tenant.
        return RecipeLine.objects.select_related("ingredient", "dish").filter(
            dish__business=self.access.business
        )


# ---------------------------------------------------------------------------------------------
# Entries
# ---------------------------------------------------------------------------------------------


class WastageViewSet(TenantScopedViewSet):
    queryset = Wastage.objects.select_related("ingredient", "entered_by").all()
    serializer_class = WastageSerializer
    audit_name = "wastage"
    create_capability = Capability.WASTAGE_ADD
    write_capability = Capability.ENTRY_EDIT
    filterset_fields = ["date", "ingredient", "reason"]

    @action(detail=False, methods=["get"], url_path="reasons")
    def reasons(self, request, *args, **kwargs):
        return Response(
            [{"value": value, "label": label} for value, label in WastageReason.choices]
        )


class PurchaseViewSet(TenantScopedViewSet):
    queryset = Purchase.objects.select_related("ingredient", "vendor", "received_by").all()
    serializer_class = PurchaseSerializer
    audit_name = "purchase"
    create_capability = Capability.RECEIVE_GOODS
    write_capability = Capability.ENTRY_EDIT
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    filterset_fields = ["date", "ingredient", "vendor"]

    def perform_create(self, serializer):
        with transaction.atomic():
            purchase = super().perform_create(serializer)
            services.auto_fulfil_from_purchase(self.access, purchase)
        return purchase


class SaleViewSet(TenantScopedViewSet):
    queryset = Sale.objects.select_related("dish", "entered_by").all()
    serializer_class = SaleSerializer
    audit_name = "sale"
    # Non-negotiable #4: reading is gated too, not just writing. Without `read_capability` a Head Chef
    # could list every sale — which is precisely the figure a blind count must not reveal.
    read_capability = Capability.SEE_SALES
    create_capability = Capability.SALES_RECORD
    write_capability = Capability.ENTRY_EDIT
    filterset_fields = ["date", "dish", "source"]

    def perform_create(self, serializer):
        dish = serializer.validated_data["dish"]
        day = serializer.validated_data["date"]
        existing = Sale.objects.filter(business=self.access.business, dish=dish, date=day).first()
        if existing is not None:
            from core.exceptions import AlreadyCapturedError

            raise AlreadyCapturedError(
                f"Sales for {dish.name} on {day} are already recorded "
                f"({existing.plates} plates). Ask an Owner to correct it.",
                detail={"dish": dish.name, "date": str(day), "plates": existing.plates},
            )
        return super().perform_create(serializer)


class RequestViewSet(TenantScopedViewSet):
    queryset = Request.objects.select_related("ingredient", "requested_by").all()
    serializer_class = RequestSerializer
    audit_name = "request"
    create_capability = Capability.REQUEST_RAISE
    write_capability = Capability.ENTRY_EDIT
    filterset_fields = ["status", "ingredient", "date"]

    @action(detail=True, methods=["post"], url_path="fulfil")
    def fulfil(self, request, *args, **kwargs):
        if not self.access.can(Capability.REQUEST_FULFIL):
            raise BusinessRuleError(
                "Only a Manager, Owner or Super Admin can fulfil a request.", code="forbidden"
            )
        instance = self.get_object()
        purchase = None
        purchase_id = request.data.get("purchase")
        if purchase_id:
            purchase = get_object_or_404(Purchase, pk=purchase_id, business=self.access.business)
        services.fulfil_request(self.access, instance, purchase)
        return Response(self.get_serializer(instance).data)


class SalesImportViewSet(TenantScopedViewSet):
    queryset = SalesImport.objects.select_related("uploaded_by").all()
    serializer_class = SalesImportSerializer
    audit_name = "sales_import"
    read_capability = Capability.SEE_SALES
    create_capability = Capability.SALES_RECORD
    write_capability = Capability.ENTRY_EDIT
    http_method_names = ["get", "delete", "head", "options"]


# ---------------------------------------------------------------------------------------------
# Daily stock
# ---------------------------------------------------------------------------------------------


class StockListView(TenantAPIView):
    """The capture screen's payload for one day.

    Non-negotiable #4: this returns the previous closing (so the opening can pre-fill) and today's
    purchases (needed for the impossible-count guard), and *nothing* about sales, expected usage or a
    computed closing figure. A chef who can see the expected number will write it down.
    """

    read_capability = Capability.STOCK_CAPTURE

    def get(self, request, *args, **kwargs):
        day = _parse_date(request) or timezone.localdate()
        business = self.access.business
        ingredients = list(
            Ingredient.objects.filter(business=business, track=True).order_by("name")
        )
        rows_by_ingredient = {
            row.ingredient_id: row
            for row in DailyStock.objects.filter(
                business=business, ingredient__in=ingredients, date=day
            ).select_related("opened_by", "closed_by")
        }

        payload = []
        for ingredient in ingredients:
            row = rows_by_ingredient.get(ingredient.id)
            purchased = services.purchased_on(business, ingredient, day)
            opening = row.opening_qty if row else None
            payload.append(
                {
                    "ingredient": ingredient.id,
                    "code": ingredient.code,
                    "name": ingredient.name,
                    "unit": ingredient.unit,
                    "opening_qty": opening,
                    "opened_by": (
                        (row.opened_by.name or row.opened_by.phone)
                        if row and row.opened_by
                        else None
                    ),
                    "closing_qty": row.closing_qty if row else None,
                    "closed_by": (
                        (row.closed_by.name or row.closed_by.phone)
                        if row and row.closed_by
                        else None
                    ),
                    "suggested_opening": services.suggested_opening(business, ingredient, day),
                    "purchased_today": purchased,
                    # The ceiling is arithmetic the user can already do from the two numbers above;
                    # sending it keeps the client from reimplementing the guard (non-negotiable #5).
                    "closing_ceiling": (
                        opening or services.suggested_opening(business, ingredient, day)
                    )
                    + purchased,
                    # Reflecting the ingredient's own logged wastage back on the stock ledger is not a
                    # blind-count violation (non-negotiable #4) — it's what the same person just typed
                    # in, not an expected-usage or variance figure computed from sales.
                    "wastage_today": services.wastage_on(business, ingredient, day),
                }
            )
        return Response(
            {
                "date": day,
                "rows": payload,
                "can_add_ingredient": self.access.can(Capability.CONFIG_ADD),
            }
        )


class StockOpenView(TenantAPIView):
    create_capability = Capability.STOCK_CAPTURE

    def post(self, request, *args, **kwargs):
        serializer = StockCaptureSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        stock = services.capture_opening(
            self.access,
            serializer.validated_data["ingredient"],
            serializer.validated_data["qty"],
            serializer.validated_data.get("date"),
        )
        return Response(DailyStockSerializer(stock).data, status=status.HTTP_201_CREATED)

    def get_serializer_context(self):
        return {"access": self.access, "business": self.access.business, "request": self.request}


class StockCloseView(StockOpenView):
    create_capability = Capability.STOCK_CAPTURE

    def post(self, request, *args, **kwargs):
        serializer = StockCaptureSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        stock = services.capture_closing(
            self.access,
            serializer.validated_data["ingredient"],
            serializer.validated_data["qty"],
            serializer.validated_data.get("date"),
        )
        return Response(DailyStockSerializer(stock).data, status=status.HTTP_201_CREATED)


class DayView(TenantAPIView):
    """Everything entered on one date, across tables — the "what did we record today" screen."""

    def get(self, request, tenant_id, date, *args, **kwargs):
        from django.utils.dateparse import parse_date

        day = parse_date(date)
        if day is None:
            raise BusinessRuleError("Date must be YYYY-MM-DD.", code="bad_date")
        business = self.access.business
        context = self.get_serializer_context()

        payload = {
            "date": day,
            "wastage": WastageSerializer(
                Wastage.objects.filter(business=business, date=day).select_related(
                    "ingredient", "entered_by"
                ),
                many=True,
                context=context,
            ).data,
            "stock": DailyStockSerializer(
                DailyStock.objects.filter(business=business, date=day).select_related(
                    "ingredient", "opened_by", "closed_by"
                ),
                many=True,
                context=context,
            ).data,
            "purchases": PurchaseSerializer(
                Purchase.objects.filter(business=business, date=day).select_related(
                    "ingredient", "vendor", "received_by"
                ),
                many=True,
                context=context,
            ).data,
            "requests": RequestSerializer(
                Request.objects.filter(business=business, date=day).select_related(
                    "ingredient", "requested_by"
                ),
                many=True,
                context=context,
            ).data,
        }
        # Blind counts again: sales are withheld from anyone who records physical quantities.
        if self.access.can(Capability.SEE_SALES):
            payload["sales"] = SaleSerializer(
                Sale.objects.filter(business=business, date=day).select_related(
                    "dish", "entered_by"
                ),
                many=True,
                context=context,
            ).data
        return Response(payload)

    def get_serializer_context(self):
        return {"access": self.access, "business": self.access.business, "request": self.request}


# ---------------------------------------------------------------------------------------------
# Generic correction endpoint (Owner/SA)
# ---------------------------------------------------------------------------------------------


CORRECTABLE = {
    "wastage": (Wastage, WastageSerializer),
    "stock": (DailyStock, DailyStockSerializer),
    "purchase": (Purchase, PurchaseSerializer),
    "sale": (Sale, SaleSerializer),
    "request": (Request, RequestSerializer),
}


class EntryCorrectionView(TenantAPIView):
    """PATCH/DELETE any saved entry — Owner/SA only, always audit-logged (non-negotiable #2).

    One endpoint rather than per-table edit permissions, so there is a single place where "can this
    person correct things" is decided and a single place that writes the before/after trail.
    """

    read_capability = Capability.ENTRY_EDIT
    write_capability = Capability.ENTRY_EDIT

    def _resolve(self, table, pk):
        if table not in CORRECTABLE:
            raise BusinessRuleError(
                f"'{table}' is not a correctable entry type. "
                f"Expected one of: {', '.join(sorted(CORRECTABLE))}.",
                code="bad_table",
            )
        model, serializer_class = CORRECTABLE[table]
        instance = get_object_or_404(model, pk=pk, business=self.access.business)
        return instance, serializer_class

    def get(self, request, tenant_id, table, pk, *args, **kwargs):
        instance, serializer_class = self._resolve(table, pk)
        return Response(serializer_class(instance, context=self._context()).data)

    def patch(self, request, tenant_id, table, pk, *args, **kwargs):
        instance, serializer_class = self._resolve(table, pk)
        before = serializer_class(instance, context=self._context()).data
        serializer = serializer_class(
            instance, data=request.data, partial=True, context=self._context()
        )
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        after = serializer_class(updated, context=self._context()).data
        record_update(self.access, table, updated, before, after)
        return Response(after)

    def delete(self, request, tenant_id, table, pk, *args, **kwargs):
        instance, serializer_class = self._resolve(table, pk)
        before = serializer_class(instance, context=self._context()).data
        record_delete(self.access, table, instance, before)
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _context(self):
        return {"access": self.access, "business": self.access.business, "request": self.request}


class HomeView(TenantAPIView):
    def get(self, request, *args, **kwargs):
        from reports.home import home

        return Response(home(self.access))


class RecentEntriesView(TenantAPIView):
    """Last N days of entries for the list screens, with Edit/Delete shown only to Owner/SA."""

    def get(self, request, *args, **kwargs):
        days = int(request.query_params.get("days", 7))
        end = timezone.localdate()
        start = end - timedelta(days=days)
        business = self.access.business
        context = {"access": self.access, "business": business, "request": request}

        payload = {
            "start": start,
            "end": end,
            "can_edit": self.access.can(Capability.ENTRY_EDIT),
            "wastage": WastageSerializer(
                Wastage.objects.filter(business=business, date__gte=start).select_related(
                    "ingredient", "entered_by"
                )[:200],
                many=True,
                context=context,
            ).data,
            "purchases": PurchaseSerializer(
                Purchase.objects.filter(business=business, date__gte=start).select_related(
                    "ingredient", "vendor", "received_by"
                )[:200],
                many=True,
                context=context,
            ).data,
            "requests": RequestSerializer(
                Request.objects.filter(business=business).select_related(
                    "ingredient", "requested_by"
                )[:200],
                many=True,
                context=context,
            ).data,
        }
        if self.access.can(Capability.SEE_SALES):
            payload["sales"] = SaleSerializer(
                Sale.objects.filter(business=business, date__gte=start).select_related(
                    "dish", "entered_by"
                )[:200],
                many=True,
                context=context,
            ).data
        return Response(payload)
