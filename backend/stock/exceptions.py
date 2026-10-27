from rest_framework.exceptions import APIException


class BulkValidationError(APIException):
    """Carries per-row errors in `.row_errors` — config/exceptions.py adds them to the response
    alongside the normal {"error": {...}} shape."""

    status_code = 422
    default_detail = "Some rows need fixing before this can be saved."
    default_code = "BULK_VALIDATION_ERROR"

    def __init__(self, row_errors: list[dict]):
        super().__init__()
        self.row_errors = row_errors


class TooManyRows(APIException):
    status_code = 422
    default_code = "TOO_MANY_ROWS"

    def __init__(self, max_rows: int):
        super().__init__(detail=f"You can add up to {max_rows} rows at a time.")


class StockItemUnitLocked(APIException):
    status_code = 422
    default_detail = (
        "This item's unit can't be changed — it already has purchase, count, wastage or sale "
        "history in the old unit."
    )
    default_code = "STOCK_ITEM_UNIT_LOCKED"


class StockItemInUse(APIException):
    """Carries the names of the active sell items whose recipe still includes this stock item,
    folded straight into the message — there's no separate client-side lookup for this one."""

    status_code = 422
    default_code = "STOCK_ITEM_IN_USE"

    def __init__(self, sell_item_names: list[str]):
        names = ", ".join(sell_item_names)
        super().__init__(
            detail=f"Can't deactivate — still used as an ingredient in: {names}. "
            "Deactivate those first."
        )


class BaseInUse(APIException):
    """Step 42b1c1: a base can't be deleted outright while a dish still uses it — the caller must
    resend the delete with `confirm_unlink: true` to delete it anyway, unlinking it from every dish
    that used it (same 409-then-resubmit-with-a-flag shape as businesses.exceptions.
    ItemsDecisionNeeded), rather than being stuck forever behind SellItemBase's PROTECT."""

    status_code = 409
    default_code = "base_in_use"

    def __init__(self, sell_item_names: list[str]):
        self.used_in_names = sell_item_names
        names = ", ".join(sell_item_names)
        super().__init__(
            detail=f"Used by: {names}. Deleting it will remove it from their recipes too — "
            "send confirm_unlink to delete anyway."
        )
