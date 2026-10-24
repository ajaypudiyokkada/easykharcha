from datetime import timedelta
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.log import log_action
from businesses.models import Business
from businesses.permissions import require_permission
from stock.units import UnitEntryError, convert_entry_price, convert_entry_quantity

from .exceptions import PurchaseValidationError, TooManyLines
from .models import Purchase, PurchaseLine, Supplier
from .serializers import PurchaseCreateSerializer, PurchaseLineRowSerializer, PurchaseSerializer

MAX_LINES = 20
PAGE_SIZE = 50


def _row_errors_from(row_number: int, errors: dict) -> list[dict]:
    flattened = []
    for field, messages in errors.items():
        message = messages[0] if isinstance(messages, list) else messages
        flattened.append({"row": row_number, "field": field, "message": str(message)})
    return flattened


def _lines_from_request(request) -> list:
    lines = request.data.get("lines")
    if not isinstance(lines, list) or not lines:
        raise ValidationError({"lines": "Add at least one line."})
    if len(lines) > MAX_LINES:
        raise TooManyLines()
    return lines


def _resolve_supplier(business: Business, name: str) -> Supplier | None:
    if not name:
        return None
    supplier, _ = Supplier.objects.get_or_create(
        business=business, name__iexact=name, defaults={"name": name}
    )
    return supplier


def _validate_lines(business: Business, raw_lines: list) -> list[dict]:
    """Returns cleaned line dicts (with a real `StockItem` swapped in for the id) or raises
    PurchaseValidationError with every line's errors at once."""
    stock_items_by_id = {item.id: item for item in business.stock_items.filter(active=True)}
    row_errors: list[dict] = []
    cleaned = []

    for index, row in enumerate(raw_lines, start=1):
        serializer = PurchaseLineRowSerializer(data=row)
        if not serializer.is_valid():
            row_errors.extend(_row_errors_from(index, serializer.errors))
            continue
        data = serializer.validated_data
        stock_item = stock_items_by_id.get(data["stock_item"])
        if stock_item is None:
            row_errors.append(
                {
                    "row": index,
                    "field": "stock_item",
                    "message": "Choose a stock item from this business.",
                }
            )
            continue
        data["stock_item"] = stock_item
        entry_unit = data.pop("entry_unit", None)
        try:
            data["quantity"] = convert_entry_quantity(data["quantity"], entry_unit, stock_item)
            data["unit_price"] = convert_entry_price(data["unit_price"], entry_unit, stock_item)
        except UnitEntryError as exc:
            row_errors.append({"row": index, "field": "entry_unit", "message": str(exc)})
            continue
        cleaned.append(data)

    if row_errors:
        raise PurchaseValidationError(row_errors)
    return cleaned


def _business_today_start(business: Business):
    tz = ZoneInfo(business.timezone)
    now_local = timezone.localtime(timezone.now(), tz)
    return now_local.replace(hour=0, minute=0, second=0, microsecond=0)


def _summary_for(business: Business) -> dict:
    today_start = _business_today_start(business)
    week_start = today_start - timedelta(days=7)
    active = Purchase.objects.filter(business=business, is_deleted=False)

    bought_today = (
        active.filter(purchase_date_time__gte=today_start).aggregate(total=Sum("total_amount"))[
            "total"
        ]
        or 0
    )
    last_7_days = (
        active.filter(purchase_date_time__gte=week_start).aggregate(total=Sum("total_amount"))[
            "total"
        ]
        or 0
    )
    supplier_count = active.exclude(supplier__isnull=True).values("supplier").distinct().count()
    return {
        "bought_today": str(bought_today),
        "last_7_days": str(last_7_days),
        "supplier_count": supplier_count,
    }


class SupplierListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "purchases.view")
        names = business.suppliers.order_by("name").values_list("name", flat=True)
        return Response(list(names))


class PurchaseListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "purchases.view")

        qs = (
            Purchase.objects.filter(business=business, is_deleted=False)
            .select_related("supplier", "recorded_by")
            .prefetch_related("lines__stock_item")
        )

        search = (request.query_params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(supplier__name__icontains=search) | Q(lines__stock_item__name__icontains=search)
            ).distinct()

        date_from = request.query_params.get("date_from")
        date_to = request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(purchase_date_time__date__gte=date_from)
        if date_to:
            qs = qs.filter(purchase_date_time__date__lte=date_to)

        paginator = PageNumberPagination()
        paginator.page_size = PAGE_SIZE
        page = paginator.paginate_queryset(qs, request)
        response = paginator.get_paginated_response(PurchaseSerializer(page, many=True).data)
        response.data["summary"] = _summary_for(business)
        return response

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "purchases.create")

        header = PurchaseCreateSerializer(data=request.data)
        header.is_valid(raise_exception=True)
        raw_lines = _lines_from_request(request)
        cleaned_lines = _validate_lines(business, raw_lines)

        supplier = _resolve_supplier(business, header.validated_data["supplier_name"])
        total_amount = sum((line["line_total"] for line in cleaned_lines), start=0) or 0

        with transaction.atomic():
            purchase = Purchase.objects.create(
                business=business,
                supplier=supplier,
                purchase_date_time=header.validated_data["purchase_date_time"],
                total_amount=total_amount,
                note=header.validated_data["note"],
                recorded_by=request.user,
            )
            PurchaseLine.objects.bulk_create(
                [PurchaseLine(purchase=purchase, **line) for line in cleaned_lines]
            )

        log_action(
            user=request.user,
            action="purchase.create",
            business=business,
            purchase_id=purchase.id,
            total_amount=str(total_amount),
            line_count=len(cleaned_lines),
            supplier=supplier.name if supplier else None,
        )
        purchase.refresh_from_db()
        return Response(PurchaseSerializer(purchase).data, status=201)


def _purchase_snapshot(purchase: Purchase) -> dict:
    return {
        "supplier": purchase.supplier.name if purchase.supplier else None,
        "purchase_date_time": purchase.purchase_date_time.isoformat(),
        "total_amount": str(purchase.total_amount),
        "note": purchase.note,
        "line_count": purchase.lines.count(),
    }


class PurchaseDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id, pid):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "purchases.view")
        purchase = get_object_or_404(Purchase, id=pid, business=business, is_deleted=False)
        return Response(PurchaseSerializer(purchase).data)

    def patch(self, request, business_id, pid):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "purchases.edit")
        purchase = get_object_or_404(Purchase, id=pid, business=business, is_deleted=False)
        before = _purchase_snapshot(purchase)

        header = PurchaseCreateSerializer(data=request.data)
        header.is_valid(raise_exception=True)
        raw_lines = _lines_from_request(request)
        cleaned_lines = _validate_lines(business, raw_lines)

        supplier = _resolve_supplier(business, header.validated_data["supplier_name"])
        total_amount = sum((line["line_total"] for line in cleaned_lines), start=0) or 0

        with transaction.atomic():
            purchase.supplier = supplier
            purchase.purchase_date_time = header.validated_data["purchase_date_time"]
            purchase.note = header.validated_data["note"]
            purchase.total_amount = total_amount
            purchase.save()
            purchase.lines.all().delete()
            PurchaseLine.objects.bulk_create(
                [PurchaseLine(purchase=purchase, **line) for line in cleaned_lines]
            )

        purchase.refresh_from_db()
        log_action(
            user=request.user,
            action="purchase.update",
            business=business,
            purchase_id=purchase.id,
            before=before,
            after=_purchase_snapshot(purchase),
        )
        return Response(PurchaseSerializer(purchase).data)

    def delete(self, request, business_id, pid):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "purchases.delete")
        purchase = get_object_or_404(Purchase, id=pid, business=business, is_deleted=False)
        snapshot = _purchase_snapshot(purchase)

        purchase.is_deleted = True
        purchase.deleted_by = request.user
        purchase.deleted_at = timezone.now()
        purchase.save(update_fields=["is_deleted", "deleted_by", "deleted_at"])

        log_action(
            user=request.user,
            action="purchase.delete",
            business=business,
            purchase_id=purchase.id,
            purchase=snapshot,
        )
        return Response(status=204)
