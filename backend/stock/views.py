from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.log import log_action
from businesses.access import owner_access_or_403
from businesses.models import Business

from .exceptions import BulkValidationError, TooManyRows
from .models import SellItem, StockItem
from .serializers import (
    SellItemRowSerializer,
    SellItemSerializer,
    StockItemRowSerializer,
    StockItemSerializer,
)

MAX_BULK_ROWS = 100


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
        owner_access_or_403(business, request.user)
        items = business.stock_items.filter(active=True)
        return Response(StockItemSerializer(items, many=True).data)


class StockItemBulkCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        owner_access_or_403(business, request.user)
        rows = _rows_from_request(request)

        existing_names = {
            name.lower() for name in business.stock_items.values_list("name", flat=True)
        }
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
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        owner_access_or_403(business, request.user)
        items = business.sell_items.filter(active=True)
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
