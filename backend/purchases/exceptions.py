from rest_framework.exceptions import APIException


class PurchaseValidationError(APIException):
    """Carries per-line errors in `.row_errors` — config/exceptions.py adds them to the response
    alongside the normal {"error": {...}} shape. Same shape as stock's bulk-create errors."""

    status_code = 422
    default_detail = "Some lines need fixing before this can be saved."
    default_code = "PURCHASE_VALIDATION_ERROR"

    def __init__(self, row_errors: list[dict]):
        super().__init__()
        self.row_errors = row_errors


class TooManyLines(APIException):
    status_code = 422
    default_detail = "You can add up to 20 lines in one purchase."
    default_code = "TOO_MANY_LINES"
