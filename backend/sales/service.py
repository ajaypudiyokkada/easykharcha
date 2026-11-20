"""The one place Sale rows are validated and written. Shared by the manual flow
(sales/views.py's SaleListCreateView.post) and Create Invoice (invoices/service.py), so a sale means
exactly the same thing whichever way it was recorded. Callers own the transaction and the audit log."""

from datetime import date
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.utils import timezone

from businesses.models import Business

from .exceptions import FutureSaleDate, SaleValidationError
from .models import Sale, SaleSource
from .serializers import SaleLineRowSerializer

MAX_LINES = 30
ZERO = Decimal("0")


def business_today(business: Business) -> date:
    tz = ZoneInfo(business.timezone)
    return timezone.localtime(timezone.now(), tz).date()


def check_sale_date(business: Business, business_date: date) -> None:
    if business_date > business_today(business):
        raise FutureSaleDate()


def row_errors_from(row_number: int, errors: dict) -> list[dict]:
    flattened = []
    for field, messages in errors.items():
        message = messages[0] if isinstance(messages, list) else messages
        flattened.append({"row": row_number, "field": field, "message": str(message)})
    return flattened


def validate_lines(business: Business, raw_lines: list) -> list[dict]:
    """Returns cleaned line dicts (with a real `SellItem` swapped in for the id, and `amount` filled
    in from quantity x selling price when left out) or raises SaleValidationError with every line's
    errors at once."""
    sell_items_by_id = {item.id: item for item in business.sell_items.filter(active=True)}
    row_errors: list[dict] = []
    cleaned = []

    for index, row in enumerate(raw_lines, start=1):
        serializer = SaleLineRowSerializer(data=row)
        if not serializer.is_valid():
            row_errors.extend(row_errors_from(index, serializer.errors))
            continue
        data = serializer.validated_data
        sell_item = sell_items_by_id.get(data["sell_item"])
        if sell_item is None:
            row_errors.append(
                {
                    "row": index,
                    "field": "sell_item",
                    "message": "Choose an item from this business.",
                }
            )
            continue
        amount = data.get("amount")
        if amount is None:
            amount = (data["quantity"] * sell_item.selling_price).quantize(Decimal("0.01"))
        cleaned.append({"sell_item": sell_item, "quantity": data["quantity"], "amount": amount})

    if row_errors:
        raise SaleValidationError(row_errors)
    return cleaned


def record_sales(
    *,
    business: Business,
    user,
    business_date: date,
    lines: list[dict],
    source: str = SaleSource.MANUAL,
) -> list[Sale]:
    """Writes one Sale row per cleaned line (`sell_item`, `quantity`, `amount` = BEFORE any tax) and
    returns them in order. Must be called inside the caller's transaction.atomic()."""
    return Sale.objects.bulk_create(
        [
            Sale(
                business=business,
                business_date=business_date,
                recorded_by=user,
                source=source,
                sell_item=line["sell_item"],
                quantity=line["quantity"],
                amount=line["amount"],
            )
            for line in lines
        ]
    )
