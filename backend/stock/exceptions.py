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
    default_detail = "You can add up to 100 rows at a time."
    default_code = "TOO_MANY_ROWS"
