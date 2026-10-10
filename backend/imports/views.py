import json

from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from core.exceptions import BusinessRuleError
from core.roles import Capability
from core.viewsets import TenantAPIView
from imports import matching, services
from imports.parsers import formats, parse
from inventory.serializers import SalesImportSerializer

MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class SalesImportFormatsView(TenantAPIView):
    """Approved formats for the source dropdown. First is the recommended one."""

    read_capability = Capability.SALES_RECORD

    def get(self, request, *args, **kwargs):
        return Response({"formats": formats(), "default": "auto"})


class _ImportBase(TenantAPIView):
    create_capability = Capability.SALES_RECORD
    parser_classes = [MultiPartParser, FormParser]

    def read_upload(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            raise BusinessRuleError("Attach the sales report as `file`.", code="no_file")
        if upload.size > MAX_UPLOAD_BYTES:
            raise BusinessRuleError("That file is larger than 10 MB.", code="file_too_large")
        return upload.name, upload.read()

    def parse_upload(self, request):
        name, data = self.read_upload(request)
        business = self.access.business
        result = parse(
            name,
            data,
            format_key=request.data.get("format") or "auto",
            cutoff_hour=business.business_day_cutoff_hour,
        )
        return name, data, result


class SalesImportPreviewView(_ImportBase):
    """Parse, reconcile and match. Writes nothing."""

    def post(self, request, *args, **kwargs):
        name, data, result = self.parse_upload(request)
        if not result.rows:
            raise BusinessRuleError(
                "No usable sales rows in that file.",
                code="no_rows",
                detail={"excluded": result.excluded_by_reason()},
            )
        preview = services.build_preview(self.access.business, result, filename=name)
        preview["file_hash"] = services.content_hash(
            data, result.format_key, result.date_from, result.date_to
        )
        return Response(preview)


class SalesImportConfirmView(_ImportBase):
    """Re-uploads the same file and writes the matched rows.

    The file is parsed again here rather than trusting a preview payload posted back by the client.
    Otherwise anyone could post arbitrary plate counts to this endpoint and call it an import, and
    every downstream variance figure would inherit the lie.
    """

    def post(self, request, *args, **kwargs):
        name, data, result = self.parse_upload(request)
        if not result.rows:
            raise BusinessRuleError("No usable sales rows in that file.", code="no_rows")

        business = self.access.business
        aliases = _aliases(request)
        if aliases:
            # Saved before matching so newly mapped items land in `matched` on this same request.
            matching.apply_aliases(business, aliases)

        preview = services.build_preview(business, result, filename=name)
        if not preview["matched"]:
            raise BusinessRuleError(
                "Nothing in that file matched a menu item. Map the item names first.",
                code="nothing_matched",
                detail={"unmatched": [entry["item"] for entry in preview["unmatched"]]},
            )

        file_hash = services.content_hash(data, result.format_key, result.date_from, result.date_to)
        outcome = services.confirm(
            self.access, filename=name, result=result, preview=preview, file_hash=file_hash
        )
        return Response(
            {
                "import": SalesImportSerializer(outcome["import"]).data,
                "created": outcome["created"],
                "replaced": outcome["replaced"],
                "already_imported": outcome["already_imported"],
                "message": outcome["message"],
                "reconciliation": preview["reconciliation"],
                "unmatched": preview["unmatched"],
                "blocked_by_manual": preview["blocked_by_manual"],
            }
        )


def _aliases(request) -> dict:
    """`aliases` arrives as JSON in multipart form data.

    Either `{"POS name": dish_id}` or `{"POS name": {"dish": id, "plate_multiplier": 0.5}}`.
    """
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
