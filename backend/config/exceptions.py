"""One error shape for every endpoint: {"error": {"code": "...", "message": "..."}}."""

from django.http import Http404
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        return None

    if isinstance(exc, Http404):
        code, message = "not_found", "Not found."
    elif isinstance(exc, PermissionDenied):
        code, message = "forbidden", "Forbidden."
    else:
        code = getattr(exc, "default_code", "error")
        message = _first_message(response.data)

    body = {"error": {"code": code, "message": message}}
    row_errors = getattr(exc, "row_errors", None)
    if row_errors is not None:
        body["row_errors"] = row_errors
    item_ids = getattr(exc, "item_ids", None)
    if item_ids is not None:
        body["item_ids"] = item_ids
    items_summary = getattr(exc, "items_summary", None)
    if items_summary is not None:
        body["items_summary"] = items_summary

    return Response(body, status=response.status_code)


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
