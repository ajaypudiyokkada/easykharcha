"""Reads one imported bill (Step S4a). Run inline by the upload view under AI_FAKE (so dev and the
smoke suite need no worker) and by the run_ai_jobs poll loop otherwise. It only ever writes a DRAFT
onto the InvoiceImport: no Sale and no Invoice is created here, and the model never does any maths."""

import logging

from django.utils import timezone

from ai import files as ai_files
from ai.limits import monthly_cost_cap_exceeded, record_usage
from ai.models import AiUsageKind
from ai.provider import extract_invoice
from ai.provider.errors import AiProviderCallError, AiSchemaError

from .images import absolute_path
from .models import ImportStatus, InvoiceImport, StoredImage, StoredImageKind

logger = logging.getLogger(__name__)


def process_invoice_import(import_id: int) -> None:
    imp = InvoiceImport.objects.select_related("business", "image").get(id=import_id)
    if imp.status not in (ImportStatus.QUEUED, ImportStatus.READING):
        return
    now = timezone.now()
    InvoiceImport.objects.filter(id=imp.id).update(
        status=ImportStatus.READING, started_at=now, heartbeat=now
    )
    imp.status = ImportStatus.READING
    try:
        _run(imp)
    finally:
        if imp.temp_dir:
            ai_files.delete_temp_dir(imp.temp_dir)


def _load_files(imp: InvoiceImport) -> list[dict] | None:
    if imp.image_id:
        try:
            data = absolute_path(imp.image).read_bytes()
        except (FileNotFoundError, ValueError, OSError):
            return None
        return [{"media_type": "image/jpeg", "data": data}]
    if imp.temp_dir:
        try:
            return ai_files.load_temp_files(imp.temp_dir)
        except (FileNotFoundError, ValueError, OSError):
            return None
    return None


def _run(imp: InvoiceImport) -> None:
    if monthly_cost_cap_exceeded():
        _fail(imp, "AI_UNAVAILABLE")
        return
    files = _load_files(imp)
    if files is None:
        _fail(imp, "FILE_MISSING")
        return

    try:
        result = extract_invoice(files, imp.fixture)
    except AiProviderCallError:
        _fail(imp, "AI_PROVIDER_ERROR")
        return
    except AiSchemaError:
        _fail(imp, "AI_SCHEMA_INVALID")
        return

    record_usage(
        business=imp.business,
        kind=AiUsageKind.INVOICE_READ,
        model=result.model,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
    )

    data = result.data
    readability = data.pop("readability", {"ok": True, "reason": ""})
    if not readability.get("ok", True):
        _fail(imp, "NOT_READABLE", reason=readability.get("reason", ""), model=result.model)
        return

    same_import_id = _same_photo_import_id(imp)
    data["same_photo_before"] = same_import_id is not None
    data["same_photo_import_id"] = same_import_id if same_import_id not in (None, 0) else None
    _finish(imp, ImportStatus.READY, draft=data, model=result.model)


def _same_photo_import_id(imp: InvoiceImport) -> int | None:
    """The id of an earlier, successfully read import of this business with the same photo, or 0 when
    the same photo was only used as a payment proof, else None. Warn-only: never blocks."""
    earlier = (
        InvoiceImport.objects.filter(
            business_id=imp.business_id,
            file_sha256=imp.file_sha256,
            status=ImportStatus.READY,
            id__lt=imp.id,
        )
        .order_by("-id")
        .first()
    )
    if earlier is not None:
        return earlier.id
    if StoredImage.objects.filter(
        business_id=imp.business_id,
        sha256=imp.file_sha256,
        kind=StoredImageKind.PAYMENT_PROOF,
    ).exists():
        return 0
    return None


def _fail(imp: InvoiceImport, code: str, *, reason: str = "", model: str = "") -> None:
    _finish(imp, ImportStatus.FAILED, error_code=code, error_reason=reason, model=model)


def _finish(imp: InvoiceImport, status: str, **fields) -> None:
    """Only moves a job that is still READING: an owner who abandoned it meanwhile keeps that."""
    now = timezone.now()
    InvoiceImport.objects.filter(id=imp.id, status=ImportStatus.READING).update(
        status=status,
        finished_at=now,
        heartbeat=now,
        draft=fields.get("draft"),
        error_code=fields.get("error_code", ""),
        error_reason=fields.get("error_reason", ""),
        model_used=fields.get("model", ""),
    )
