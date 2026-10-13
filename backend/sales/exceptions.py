from rest_framework.exceptions import APIException


class SaleValidationError(APIException):
    """Carries per-line errors in `.row_errors` — config/exceptions.py adds them to the response
    alongside the normal {"error": {...}} shape. Same shape as purchases' and counts' bulk errors."""

    status_code = 422
    default_detail = "Some lines need fixing before this can be saved."
    default_code = "SALE_VALIDATION_ERROR"

    def __init__(self, row_errors: list[dict]):
        super().__init__()
        self.row_errors = row_errors


class TooManySaleLines(APIException):
    status_code = 422
    default_detail = "You can add up to 30 lines in one sales entry."
    default_code = "TOO_MANY_SALE_LINES"


class FutureSaleDate(APIException):
    status_code = 422
    default_detail = "Choose today or an earlier date."
    default_code = "FUTURE_SALE_DATE"
