from rest_framework.exceptions import APIException


class InvoiceValidationError(APIException):
    """HTTP 400. `field_errors` maps a header field to its message and `row_errors` carries per-line
    problems ({row, field, message}); config/exceptions.py puts both in the response beside the
    usual {"error": {...}} shape, so the screen can mark every bad field at once."""

    status_code = 400
    default_detail = "Some details need fixing before this bill can be saved."
    default_code = "INVOICE_VALIDATION_ERROR"

    def __init__(self, field_errors: dict | None = None, row_errors: list | None = None):
        first = next(iter((field_errors or {}).values()), None)
        if first is None and row_errors:
            first = f"Line {row_errors[0]['row']}: {row_errors[0]['message']}"
        super().__init__(detail=first)
        self.field_errors = field_errors or {}
        self.row_errors = row_errors or []
