from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models import OuterRef, Subquery
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.log import jsonable, log_action
from businesses.access import owner_access_or_403
from businesses.models import Business
from businesses.permissions import access_or_403, permissions_for, require_permission
from counts.models import CountLine, CountLineState
from purchases.models import Purchase, PurchaseLine
from purchases.serializers import PurchaseSerializer
from wastage.models import WastageEntry

from .exceptions import BulkValidationError, StockItemInUse, StockItemUnitLocked, TooManyRows
from .models import RecipeStatus, SellItem, SellItemIngredient, StockItem
from .serializers import (
    SellItemCreateSerializer,
    SellItemRowSerializer,
    SellItemSerializer,
    SellItemUpdateSerializer,
    StockItemRowSerializer,
    StockItemSerializer,
    StockItemUpdateSerializer,
)
from .units import UnitEntryError, convert_entry_quantity

PRICE_HISTORY_POINTS = 12
RECENT_PURCHASES = 5


def _with_last_purchase_info(queryset):
    """Annotates each stock item with its latest (most recent, not-deleted) purchase line's unit
    price and purchase date — None for an item that's never been bought."""
    latest_line = PurchaseLine.objects.filter(
        stock_item=OuterRef("pk"), purchase__is_deleted=False
    ).order_by("-purchase__purchase_date_time", "-id")
    return queryset.annotate(
        last_unit_price=Subquery(latest_line.values("unit_price")[:1]),
        last_purchased_at=Subquery(latest_line.values("purchase__purchase_date_time")[:1]),
    )


def _with_last_count_info(queryset):
    """Annotates each stock item with its latest *counted* (not skipped) line's quantity and the
    count's submission time — None for an item that's never been counted. Deliberately no "on hand"
    estimate here — that needs usage math this step doesn't build yet."""
    latest_line = CountLine.objects.filter(
        stock_item=OuterRef("pk"), state=CountLineState.COUNTED
    ).order_by("-count__submitted_at", "-id")
    return queryset.annotate(
        last_counted_qty=Subquery(latest_line.values("counted_qty")[:1]),
        last_counted_at=Subquery(latest_line.values("count__submitted_at")[:1]),
    )


def _group_resolver(queryset) -> dict[str, str]:
    """Seeds a lowercase-group -> canonical-casing map from this business's existing rows (of this
    same item type) once per request. `_canonical_group` both reads *and writes* this same dict as
    it resolves each row, so two differently-cased spellings of a brand-new group *within the same
    bulk call* still fold together — querying the database per row wouldn't catch that, since
    nothing in the batch is actually saved until the loop finishes."""
    return {
        group.lower(): group
        for group in queryset.exclude(group="").values_list("group", flat=True).distinct()
    }


def _canonical_group(seen_groups: dict[str, str], typed_group: str) -> str:
    """Case-insensitive match against `seen_groups` (existing rows, plus every group already
    resolved earlier in this same request) — typing "dairy" when "Dairy" exists (on disk or
    earlier in this same batch) groups the item under the existing "Dairy" heading instead of
    splitting into a second, differently-cased one. Blank stays blank ("Ungrouped")."""
    if not typed_group:
        return ""
    canonical = seen_groups.setdefault(typed_group.lower(), typed_group)
    return canonical


def _row_errors_from(row_number: int, errors: dict) -> list[dict]:
    flattened = []
    for field, messages in errors.items():
        message = messages[0] if isinstance(messages, list) else messages
        flattened.append({"row": row_number, "field": field, "message": str(message)})
    return flattened


def _rows_from_request(request) -> list:
    rows = request.data.get("items")
    if not isinstance(rows, list) or not rows:
        raise ValidationError({"items": "Add at least one item."})
    if len(rows) > settings.MAX_BULK_ROWS:
        raise TooManyRows(settings.MAX_BULK_ROWS)
    return rows


class StockItemListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "stock.view")
        # Settings' "What you buy" screen needs inactive items too (to show and reactivate them);
        # every other caller of this list only ever wants the active ones, unchanged from before.
        base = (
            business.stock_items.all()
            if request.query_params.get("include_inactive")
            else business.stock_items.filter(active=True)
        )
        items = _with_last_count_info(_with_last_purchase_info(base))
        return Response(StockItemSerializer(items, many=True).data)


class StockItemDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id, item_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "stock.view")
        item = get_object_or_404(
            _with_last_count_info(
                _with_last_purchase_info(business.stock_items.filter(active=True))
            ),
            id=item_id,
        )

        price_points = list(
            PurchaseLine.objects.filter(stock_item=item, purchase__is_deleted=False)
            .order_by("-purchase__purchase_date_time", "-id")[:PRICE_HISTORY_POINTS]
            .values("purchase__purchase_date_time", "unit_price")
        )
        price_points.reverse()  # oldest first, for charting left-to-right

        recent_purchases = (
            Purchase.objects.filter(lines__stock_item=item, is_deleted=False)
            .distinct()
            .order_by("-purchase_date_time")[:RECENT_PURCHASES]
        )

        return Response(
            {
                **StockItemSerializer(item).data,
                "price_points": [
                    {
                        "date": point["purchase__purchase_date_time"],
                        "unit_price": point["unit_price"],
                    }
                    for point in price_points
                ],
                "recent_purchases": PurchaseSerializer(recent_purchases, many=True).data,
            }
        )

    def patch(self, request, business_id, item_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "stockitems.manage")
        item = get_object_or_404(
            _with_last_count_info(_with_last_purchase_info(business.stock_items)), id=item_id
        )

        serializer = StockItemUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if "name" in data:
            clash = business.stock_items.exclude(id=item.id).filter(name__iexact=data["name"])
            if clash.exists():
                raise ValidationError({"name": "An item with this name already exists."})

        if data.get("group"):
            data["group"] = _canonical_group(
                _group_resolver(business.stock_items.exclude(id=item.id)), data["group"]
            )

        # Step U1b-2: the lock is on the *family* a history-bearing item belongs to, not the raw
        # entry unit typed this time — re-picking "kg" on an item already stored in g is a no-op,
        # not a lock violation, since `_resolve_unit_and_family` already rewrote `data["unit"]` to
        # the base unit and `data["unit_family"]` to its family before this check runs.
        if "unit_family" in data and data["unit_family"] != item.unit_family:
            # Decision 3 (U1b-1 report): broadened from purchase/count to also cover wastage and
            # sale (recipe-usage) history — any of the four means some past row's quantity is
            # already meaningless the moment the unit's family changes under it.
            has_history = (
                PurchaseLine.objects.filter(stock_item=item).exists()
                or CountLine.objects.filter(stock_item=item).exists()
                or WastageEntry.objects.filter(stock_item=item).exists()
                or SellItemIngredient.objects.filter(stock_item=item).exists()
            )
            if has_history:
                raise StockItemUnitLocked()

        if data.get("active") is False and item.active:
            blocking = list(
                SellItem.objects.filter(ingredients__stock_item=item, active=True)
                .distinct()
                .values_list("name", flat=True)
            )
            if blocking:
                raise StockItemInUse(blocking)

        changed = sorted(data.keys())
        before = {f: jsonable(getattr(item, f)) for f in changed}
        for field, value in data.items():
            setattr(item, field, value)
        item.save()
        after = {f: jsonable(getattr(item, f)) for f in changed}

        log_action(
            user=request.user,
            action="stock_item.update",
            business=business,
            item_id=item.id,
            before=before,
            after=after,
        )
        return Response(StockItemSerializer(item).data)


class StockItemBulkCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        owner_access_or_403(business, request.user)
        rows = _rows_from_request(request)

        # A starter-pack picker sends its whole tick list in one call, and re-running it (e.g. the
        # owner goes back and forward in setup, or reopens "Add from starter list") would otherwise
        # hard-fail on whatever it already added last time — skip_existing makes that call
        # idempotent by quietly dropping already-there rows instead of erroring the whole batch.
        skip_existing = bool(request.data.get("skip_existing"))

        existing_names = {
            name.lower() for name in business.stock_items.values_list("name", flat=True)
        }
        seen_groups = _group_resolver(business.stock_items)
        seen_in_call: set[str] = set()
        row_errors: list[dict] = []
        cleaned = []

        for index, row in enumerate(rows, start=1):
            serializer = StockItemRowSerializer(data=row)
            if not serializer.is_valid():
                row_errors.extend(_row_errors_from(index, serializer.errors))
                continue
            data = serializer.validated_data
            key = data["name"].lower()
            if key in existing_names or key in seen_in_call:
                if skip_existing:
                    continue
                message = (
                    "An item with this name already exists."
                    if key in existing_names
                    else "Duplicate name in this list."
                )
                row_errors.append({"row": index, "field": "name", "message": message})
                continue
            seen_in_call.add(key)
            data["group"] = _canonical_group(seen_groups, data["group"])
            cleaned.append(data)

        if row_errors:
            raise BulkValidationError(row_errors)

        with transaction.atomic():
            created = [
                StockItem(business=business, created_by=request.user, **data) for data in cleaned
            ]
            StockItem.objects.bulk_create(created)

        log_action(
            user=request.user,
            action="stock_item.bulk_create",
            business=business,
            count=len(created),
        )
        return Response(StockItemSerializer(created, many=True).data, status=201)


def _with_ingredients(queryset):
    return queryset.prefetch_related("ingredients__stock_item")


def _linkable_stock_items(business) -> dict[int, StockItem]:
    """Non-shared, active stock items this business can pick as a dish's ingredient — shared items
    (oil, salt, packaging) don't point at any one thing sold, same rule main_stock_item used to
    enforce."""
    return {item.id: item for item in business.stock_items.filter(active=True, shared=False)}


def _resolve_ingredient_rows(
    rows: list[dict], stock_items_by_id: dict[int, StockItem]
) -> list[tuple[StockItem, Decimal]]:
    resolved = []
    for row in rows:
        stock_item = stock_items_by_id.get(row["stock_item"])
        if stock_item is None:
            raise ValidationError(
                {"ingredients": "Choose stock items from this business — not a shared item."}
            )
        try:
            quantity = convert_entry_quantity(row["quantity"], row.get("entry_unit"), stock_item)
        except UnitEntryError as exc:
            raise ValidationError({"ingredients": str(exc)}) from exc
        resolved.append((stock_item, quantity))
    return resolved


class SellItemListView(APIView):
    """Settings' "What you sell" (Owner, `sellitems.manage`, can ask for inactive items too) and the
    Record sales sheet (Owner/Manager, `sales.view`/`sales.create`, active items only) both read
    this — a plain permission-string OR, same pattern as TodayView's wastage.view_all/view_own."""

    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        access = access_or_403(business, request.user)
        permissions = permissions_for(access.role)
        can_manage = "sellitems.manage" in permissions
        can_record_sales = "sales.view" in permissions or "sales.create" in permissions
        if not (can_manage or can_record_sales):
            raise PermissionDenied()

        include_inactive = can_manage and request.query_params.get("include_inactive")
        items = (
            business.sell_items.all()
            if include_inactive
            else business.sell_items.filter(active=True)
        )
        return Response(SellItemSerializer(_with_ingredients(items), many=True).data)

    def post(self, request, business_id):
        """The manual dish form's single-item create (Step 22a) — name, group, portion label and at
        least one real ingredient. Always lands at recipe_status=confirmed; a plain name+price+group
        dish with no recipe yet is sell-items/bulk/'s job instead."""
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sellitems.manage")

        serializer = SellItemCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if business.sell_items.filter(name__iexact=data["name"]).exists():
            raise ValidationError({"name": "An item with this name already exists."})

        ingredient_rows = _resolve_ingredient_rows(
            data.pop("ingredients"), _linkable_stock_items(business)
        )
        data["group"] = _canonical_group(_group_resolver(business.sell_items), data["group"])
        data["recipe_status"] = RecipeStatus.CONFIRMED

        with transaction.atomic():
            item = SellItem.objects.create(business=business, created_by=request.user, **data)
            SellItemIngredient.objects.bulk_create(
                SellItemIngredient(sell_item=item, stock_item=stock_item, quantity=quantity)
                for stock_item, quantity in ingredient_rows
            )

        log_action(
            user=request.user,
            action="sell_item.create",
            business=business,
            item_id=item.id,
            ingredient_count=len(ingredient_rows),
        )
        item = _with_ingredients(business.sell_items).get(id=item.id)
        return Response(SellItemSerializer(item).data, status=201)


class SellItemBulkCreateView(APIView):
    """Creates dishes WITHOUT ingredients (Step 22a) — name, price, group and an optional portion
    label only, always recipe_status=none. The wizard and starter-pack sell items use this for
    quick setup; a dish's recipe is added afterward via SellItemListView.post's manual dish form (or
    a future AI/scan flow — see docs/MAP.md)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        owner_access_or_403(business, request.user)
        rows = _rows_from_request(request)

        # Same idempotency escape hatch as StockItemBulkCreateView's skip_existing — lets a caller
        # (a future AI/scan flow re-running its own batch) repeat itself without erroring on names
        # it already created last time.
        skip_existing = bool(request.data.get("skip_existing"))

        existing_names = {
            name.lower() for name in business.sell_items.values_list("name", flat=True)
        }
        seen_groups = _group_resolver(business.sell_items)
        seen_in_call: set[str] = set()
        row_errors: list[dict] = []
        cleaned = []

        for index, row in enumerate(rows, start=1):
            serializer = SellItemRowSerializer(data=row)
            if not serializer.is_valid():
                row_errors.extend(_row_errors_from(index, serializer.errors))
                continue
            data = serializer.validated_data

            key = data["name"].lower()
            if key in existing_names or key in seen_in_call:
                if skip_existing:
                    continue
                message = (
                    "An item with this name already exists."
                    if key in existing_names
                    else "Duplicate name in this list."
                )
                row_errors.append({"row": index, "field": "name", "message": message})
                continue
            seen_in_call.add(key)
            data["group"] = _canonical_group(seen_groups, data["group"])
            cleaned.append(data)

        if row_errors:
            raise BulkValidationError(row_errors)

        with transaction.atomic():
            created = [
                SellItem(business=business, created_by=request.user, **data) for data in cleaned
            ]
            SellItem.objects.bulk_create(created)

        log_action(
            user=request.user, action="sell_item.bulk_create", business=business, count=len(created)
        )
        return Response(SellItemSerializer(created, many=True).data, status=201)


class SellItemDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, business_id, item_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sellitems.manage")
        item = get_object_or_404(business.sell_items, id=item_id)

        serializer = SellItemUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if "name" in data:
            clash = business.sell_items.exclude(id=item.id).filter(name__iexact=data["name"])
            if clash.exists():
                raise ValidationError({"name": "An item with this name already exists."})

        if data.get("group"):
            data["group"] = _canonical_group(
                _group_resolver(business.sell_items.exclude(id=item.id)), data["group"]
            )

        # Editing a dish goes through the same form as creating one — present at all means "save
        # this recipe", so it fully replaces the ingredient rows and re-confirms, same as create.
        ingredient_rows = None
        if "ingredients" in data:
            ingredient_rows = _resolve_ingredient_rows(
                data.pop("ingredients"), _linkable_stock_items(business)
            )
            data["recipe_status"] = RecipeStatus.CONFIRMED

        changed = sorted(data.keys())
        before = {f: jsonable(getattr(item, f)) for f in changed}
        for field, value in data.items():
            setattr(item, field, value)
        item.save()
        after = {f: jsonable(getattr(item, f)) for f in changed}

        if ingredient_rows is not None:
            with transaction.atomic():
                item.ingredients.all().delete()
                SellItemIngredient.objects.bulk_create(
                    SellItemIngredient(sell_item=item, stock_item=stock_item, quantity=quantity)
                    for stock_item, quantity in ingredient_rows
                )

        log_action(
            user=request.user,
            action="sell_item.update",
            business=business,
            item_id=item.id,
            before=before,
            after=after,
        )
        item = _with_ingredients(business.sell_items).get(id=item.id)
        return Response(SellItemSerializer(item).data)
