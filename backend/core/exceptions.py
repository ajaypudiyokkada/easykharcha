"""A single error shape for the whole API, so the client has one thing to render.

{"error": {"code": "already_captured", "message": "...", "detail": {...}}}
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


class BusinessRuleError(APIException):
    """A rule from docs/product.md said no. The message is shown to the user verbatim."""

    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "business_rule"

    def __init__(self, message: str, code: str | None = None, detail: dict | None = None):
        super().__init__(message)
        self.code = code or self.default_code
        self.message = message
        self.extra = detail or {}


class AlreadyCapturedError(BusinessRuleError):
    """Second attempt at a once-per-day capture by a non-Owner (§3 DailyStock / Sale)."""

    status_code = status.HTTP_409_CONFLICT

    def __init__(self, message: str, detail: dict | None = None):
        super().__init__(message, code="already_captured", detail=detail)


def exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = _as_drf_validation_error(exc)

    if isinstance(exc, BusinessRuleError):
        return Response(
            {"error": {"code": exc.code, "message": exc.message, "detail": exc.extra}},
            status=exc.status_code,
        )

    response = drf_exception_handler(exc, context)
    if response is None:
        return None

    if isinstance(exc, Http404):
        payload = {
            "code": "not_found",
            "message": "Not found, or you do not have access to it.",
            "detail": {},
        }
    elif isinstance(exc, PermissionDenied):
        payload = {
            "code": "forbidden",
            "message": str(exc.detail) if hasattr(exc, "detail") else "Forbidden.",
            "detail": {},
        }
    else:
        detail = response.data
        payload = {
            "code": getattr(exc, "default_code", "error"),
            "message": _first_message(detail),
            "detail": detail if isinstance(detail, dict) else {"detail": detail},
        }
    return Response({"error": payload}, status=response.status_code)


def _as_drf_validation_error(exc: DjangoValidationError):
    from rest_framework.exceptions import ValidationError as DRFValidationError

    if hasattr(exc, "message_dict"):
        return DRFValidationError(exc.message_dict)
    return DRFValidationError(exc.messages)


def _first_message(detail) -> str:
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list) and detail:
        return _first_message(detail[0])
    if isinstance(detail, dict):
        for key, value in detail.items():
            message = _first_message(value)
            return message if key in ("detail", "non_field_errors") else f"{key}: {message}"
    return "Request failed."
