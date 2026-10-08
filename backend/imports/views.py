from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from core.exceptions import BusinessRuleError
from core.roles import Capability
from core.viewsets import TenantAPIView
from imports.parsers import parse_sales_file
from imports.services import confirm_import, match_rows
from inventory.serializers import SalesImportSerializer

MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class SalesImportPreviewView(TenantAPIView):
    """Parse and match, write nothing. Manager+ (§5c)."""

    create_capability = Capability.SALES_RECORD
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, *args, **kwargs):
        upload = _upload(request)
        rows, problems = parse_sales_file(upload.name, upload.read())
        if not rows:
            raise BusinessRuleError(
                "No usable sales rows in that file.", code="no_rows", detail={"problems": problems}
            )
        result = match_rows(self.access.business, rows)
        result["problems"] = problems
        result["filename"] = upload.name
        result["rows_read"] = len(rows)
        return Response(result)


class SalesImportConfirmView(TenantAPIView):
    """Re-uploads the same file and writes the matched rows.

    The file is parsed again here rather than trusting a preview payload posted back by the client —
    otherwise anyone could post arbitrary plate counts to the confirm endpoint and call it an import.
    """

    create_capability = Capability.SALES_RECORD
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, *args, **kwargs):
        upload = _upload(request)
        rows, _problems = parse_sales_file(upload.name, upload.read())
        if not rows:
            raise BusinessRuleError("No usable sales rows in that file.", code="no_rows")

        aliases = _aliases(request)
        if aliases:
            # Save the mappings first, then re-match so newly aliased items land in `matched`.
            from inventory.models import Dish

            for item, dish_id in aliases.items():
                dish = Dish.objects.filter(pk=dish_id, business=self.access.business).first()
                if dish is not None:
                    dish.pos_alias = item
                    dish.save(update_fields=["pos_alias", "updated_at"])

        result = match_rows(self.access.business, rows)
        if not result["matched"]:
            raise BusinessRuleError(
                "Nothing in that file matched a dish. Map the item names first.",
                code="nothing_matched",
                detail={"unmatched": [entry["item"] for entry in result["unmatched"]]},
            )

        batch = confirm_import(self.access, upload.name, result, aliases=None)
        return Response(
            {
                "import": SalesImportSerializer(batch).data,
                "created": len(result["matched"]),
                "unmatched": result["unmatched"],
                "blocked_by_manual": result["blocked_by_manual"],
            }
        )


def _upload(request):
    upload = request.FILES.get("file")
    if upload is None:
        raise BusinessRuleError("Attach the POS sales report as `file`.", code="no_file")
    if upload.size > MAX_UPLOAD_BYTES:
        raise BusinessRuleError("That file is larger than 10 MB.", code="file_too_large")
    return upload


def _aliases(request) -> dict:
    """`aliases` arrives as a JSON string in multipart form data: {"POS item name": dish_id}."""
    import json

    raw = request.data.get("aliases")
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise BusinessRuleError("`aliases` must be JSON.", code="bad_aliases") from exc
    if not isinstance(parsed, dict):
        raise BusinessRuleError("`aliases` must be a JSON object.", code="bad_aliases")
    return parsed
