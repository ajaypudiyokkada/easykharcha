from rest_framework.exceptions import APIException


class DuplicateCount(APIException):
    status_code = 409
    default_detail = "That count has already been submitted for today."
    default_code = "DUPLICATE_COUNT"


class NeedsConfirmation(APIException):
    """A line's value looks unusually high. Carries only the affected item ids — never a number —
    so the client can show its own guard dialog with the value the person themselves just typed."""

    status_code = 409
    default_detail = "Some values need confirming before this can be saved."
    default_code = "needs_confirmation"

    def __init__(self, item_ids: list[int]):
        super().__init__()
        self.item_ids = item_ids


class OpeningRequired(APIException):
    """A closing count was attempted for a business date with no opening count yet, and the
    opening isn't missed (its deadline hasn't passed, and the closing window hasn't begun) — so
    there's still time for the opening to happen first."""

    status_code = 409
    default_detail = "Do the opening count first."
    default_code = "opening_required"


class CountValidationError(APIException):
    """Carries per-row errors in `.row_errors` — config/exceptions.py adds them to the response
    alongside the normal {"error": {...}} shape. Same shape as purchases' and stock's bulk errors."""

    status_code = 422
    default_detail = "Some lines need fixing before this can be saved."
    default_code = "COUNT_VALIDATION_ERROR"

    def __init__(self, row_errors: list[dict]):
        super().__init__()
        self.row_errors = row_errors
