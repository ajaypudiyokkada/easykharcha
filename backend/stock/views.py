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

from .exceptions import BulkValidationError, StockItemInUse, StockItemUnitLocked, TooManyRows
from .models import SellItem, StockItem
from .serializers import (
    SellItemRowSerializer,
    SellItemSerializer,
    SellItemUpdateSerializer,
    StockItemRowSerializer,
    StockItemSerializer,
    StockItemUpdateSerializer,
)

MAX_BULK_ROWS = 100
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
    if len(rows) > MAX_BULK_ROWS:
        raise TooManyRows()
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

        if "unit" in data and data["unit"] != item.unit:
            has_history = PurchaseLine.objects.filter(stock_item=item).exists() or (
                CountLine.objects.filter(stock_item=item).exists()
            )
            if has_history:
                raise StockItemUnitLocked()

        if data.get("active") is False and item.active:
            blocking = list(item.sell_items.filter(active=True).values_list("name", flat=True))
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
        return Response(SellItemSerializer(items, many=True).data)


class SellItemBulkCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        owner_access_or_403(business, request.user)
        rows = _rows_from_request(request)

        stock_items_by_id = {item.id: item for item in business.stock_items.filter(active=True)}
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

            stock_item = None
            stock_item_id = data.pop("main_stock_item", None)
            if stock_item_id is not None:
                stock_item = stock_items_by_id.get(stock_item_id)
                if stock_item is None:
                    row_errors.append(
                        {
                            "row": index,
                            "field": "main_stock_item",
                            "message": "Choose a stock item from this business.",
                        }
                    )
                    continue
                if stock_item.shared:
                    row_errors.append(
                        {
                            "row": index,
                            "field": "main_stock_item",
                            "message": "Shared items (used in many things) can't be linked here.",
                        }
                    )
                    continue

            if data.get("uses_qty") is not None and stock_item is None:
                row_errors.append(
                    {
                        "row": index,
                        "field": "uses_qty",
                        "message": "Choose a main stock item first.",
                    }
                )
                continue

            key = data["name"].lower()
            if key in existing_names:
                row_errors.append(
                    {
                        "row": index,
                        "field": "name",
                        "message": "An item with this name already exists.",
                    }
                )
                continue
            if key in seen_in_call:
                row_errors.append(
                    {"row": index, "field": "name", "message": "Duplicate name in this list."}
                )
                continue
            seen_in_call.add(key)
            data["main_stock_item"] = stock_item
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

        if "main_stock_item" in data:
            stock_item_id = data.pop("main_stock_item")
            if stock_item_id is None:
                data["main_stock_item"] = None
            else:
                stock_item = business.stock_items.filter(id=stock_item_id).first()
                if stock_item is None:
                    raise ValidationError(
                        {"main_stock_item": "Choose a stock item from this business."}
                    )
                if stock_item.shared:
                    raise ValidationError(
                        {
                            "main_stock_item": "Shared items (used in many things) can't be "
                            "linked here."
                        }
                    )
                data["main_stock_item"] = stock_item

        resulting_main_stock_item = (
            data["main_stock_item"] if "main_stock_item" in data else item.main_stock_item
        )
        resulting_uses_qty = data["uses_qty"] if "uses_qty" in data else item.uses_qty
        if resulting_uses_qty is not None and resulting_main_stock_item is None:
            raise ValidationError({"uses_qty": "Choose a main stock item first."})

        changed = sorted(data.keys())
        before = {f: jsonable(getattr(item, f)) for f in changed}
        for field, value in data.items():
            setattr(item, field, value)
        item.save()
        after = {f: jsonable(getattr(item, f)) for f in changed}

        log_action(
            user=request.user,
            action="sell_item.update",
            business=business,
            item_id=item.id,
            before=before,
            after=after,
        )
        return Response(SellItemSerializer(item).data)
