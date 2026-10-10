"""Entry rules that are too stateful to live in a serializer.

The two that matter:
  - **once per day** — a non-Owner gets exactly one shot at opening and one at closing. The second
    attempt is refused rather than overwriting, because an overwrite is indistinguishable from a
    correction and corrections are an Owner action with an audit trail (§3).
  - **impossible count** — closing cannot exceed opening + what was purchased that day. Nothing can
    appear in the store that was not counted or bought.
"""

from datetime import date as date_type
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from audit.services import log
from core.exceptions import AlreadyCapturedError, BusinessRuleError
from core.fields import ZERO, d, q3
from core.roles import Capability
from inventory.models import DailyStock, Purchase, Request, RequestStatus, Wastage


def purchased_on(business, ingredient, day: date_type) -> Decimal:
    total = Purchase.objects.filter(business=business, ingredient=ingredient, date=day).aggregate(
        total=Sum("qty_received")
    )["total"]
    return d(total or ZERO)


def wastage_on(business, ingredient, day: date_type) -> Decimal:
    """Today's wastage logged so far for one ingredient.

    Unlike opening/closing, wastage is not once-per-day — several spills can happen in one shift — so
    this is a running total for the stock ledger to show, not a capture guard.
    """
    total = Wastage.objects.filter(business=business, ingredient=ingredient, date=day).aggregate(
        total=Sum("qty")
    )["total"]
    return d(total or ZERO)


def previous_closing(business, ingredient, day: date_type) -> Decimal | None:
    row = (
        DailyStock.objects.filter(
            business=business, ingredient=ingredient, date__lt=day, closing_qty__isnull=False
        )
        .order_by("-date")
        .first()
    )
    return row.closing_qty if row else None


def suggested_opening(business, ingredient, day: date_type) -> Decimal:
    """Opening pre-fills from the previous day's closing (§3); zero on the first ever day."""
    prior = previous_closing(business, ingredient, day)
    return d(prior) if prior is not None else ZERO


@transaction.atomic
def capture_opening(access, ingredient, qty: Decimal, day: date_type | None = None) -> DailyStock:
    day = day or timezone.localdate()
    stock, _created = DailyStock.objects.select_for_update().get_or_create(
        business=access.business, ingredient=ingredient, date=day
    )

    if stock.opening_qty is not None and not access.can(Capability.ENTRY_EDIT):
        raise AlreadyCapturedError(
            f"Opening stock for {ingredient.name} on {day} is already recorded "
            f"({q3(stock.opening_qty)} {ingredient.unit}). Ask an Owner to correct it.",
            detail={
                "ingredient": ingredient.name,
                "date": str(day),
                "existing": str(stock.opening_qty),
            },
        )

    stock.opening_qty = d(qty)
    stock.opened_by = access.user
    stock.opened_at = timezone.now()
    stock.save(update_fields=["opening_qty", "opened_by", "opened_at", "updated_at"])
    log(
        access,
        "stock.open",
        summary=f"Opening {q3(qty)} {ingredient.unit} of {ingredient.name} on {day}",
        detail={"ingredient": ingredient.code, "date": str(day), "qty": str(qty)},
    )
    return stock


@transaction.atomic
def capture_closing(access, ingredient, qty: Decimal, day: date_type | None = None) -> DailyStock:
    day = day or timezone.localdate()
    stock, _created = DailyStock.objects.select_for_update().get_or_create(
        business=access.business, ingredient=ingredient, date=day
    )

    if stock.closing_qty is not None and not access.can(Capability.ENTRY_EDIT):
        raise AlreadyCapturedError(
            f"Closing stock for {ingredient.name} on {day} is already recorded "
            f"({q3(stock.closing_qty)} {ingredient.unit}). Ask an Owner to correct it.",
            detail={
                "ingredient": ingredient.name,
                "date": str(day),
                "existing": str(stock.closing_qty),
            },
        )

    opening = stock.opening_qty
    if opening is None:
        opening = suggested_opening(access.business, ingredient, day)
    purchased = purchased_on(access.business, ingredient, day)
    ceiling = d(opening) + purchased
    if d(qty) > ceiling:
        raise BusinessRuleError(
            f"Closing count of {q3(qty)} {ingredient.unit} is more than the "
            f"{q3(ceiling)} available today (opening {q3(opening)} + purchased {q3(purchased)}). "
            "Check the count, or record the missing purchase first.",
            code="impossible_count",
            detail={
                "opening": str(q3(opening)),
                "purchased": str(q3(purchased)),
                "ceiling": str(q3(ceiling)),
                "attempted": str(q3(qty)),
            },
        )

    stock.closing_qty = d(qty)
    stock.closed_by = access.user
    stock.closed_at = timezone.now()
    stock.save(update_fields=["closing_qty", "closed_by", "closed_at", "updated_at"])
    log(
        access,
        "stock.close",
        summary=f"Closing {q3(qty)} {ingredient.unit} of {ingredient.name} on {day}",
        detail={"ingredient": ingredient.code, "date": str(day), "qty": str(qty)},
    )
    return stock


@transaction.atomic
def fulfil_request(access, request: Request, purchase: Purchase | None = None) -> Request:
    if request.status == RequestStatus.FULFILLED:
        raise BusinessRuleError("That request is already fulfilled.", code="already_fulfilled")
    request.status = RequestStatus.FULFILLED
    request.fulfilled_purchase = purchase
    request.save(update_fields=["status", "fulfilled_purchase", "updated_at"])
    log(
        access,
        "request.fulfil",
        summary=f"Fulfilled request for {request.ingredient.name}",
        detail={"request_id": request.id, "purchase_id": purchase.id if purchase else None},
    )
    return request


def auto_fulfil_from_purchase(access, purchase: Purchase) -> None:
    """A purchase that names a request closes it — nobody has to remember a second step."""
    if purchase.request_id and purchase.request.status == RequestStatus.OPEN:
        fulfil_request(access, purchase.request, purchase)
