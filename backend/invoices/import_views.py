"""Import invoice, part 1 (Step S4a): upload one bill, read it, hand back a draft. Nothing here posts
a sale or creates an invoice."""

import hashlib
from uuid import uuid4

import pypdf
from django.conf import settings
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ai import files as ai_files
from ai import limits
from audit.log import log_action
from businesses.models import Business
from businesses.permissions import require_permission

from .duplicates import draft_bill_date, find_duplicates
from .images import ImageTooLarge, InvalidImage, absolute_path, delete_file, store_image
from .import_confirm import confirm_import
from .import_jobs import process_invoice_import
from .models import ImportStatus, InvoiceImport, StoredImageKind
from .serializers import InvoiceSerializer

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 3


class InvalidImportFile(APIException):
    status_code = 400
    default_detail = "This file cannot be used. Choose a photo or PDF of one bill."
    default_code = "INVALID_FILE"


class ImportFileTooLarge(APIException):
    status_code = 400
    default_detail = "This file is too big. Choose a smaller photo or PDF."
    default_code = "FILE_TOO_LARGE"


class TooManyPages(APIException):
    status_code = 400
    default_detail = "Choose a PDF of one bill, up to 3 pages."
    default_code = "TOO_MANY_PAGES"


class PhotoNotAvailable(APIException):
    status_code = 404
    default_detail = "There is no photo for this import."
    default_code = "NO_PHOTO"


class PhotoRemoved(APIException):
    status_code = 404
    default_detail = "This bill photo was removed."
    default_code = "PHOTO_REMOVED"


def _payload(imp: InvoiceImport) -> dict:
    image = imp.image
    data = {
        "id": imp.id,
        "status": imp.status,
        "error_code": imp.error_code,
        "error_reason": imp.error_reason,
        "file_type": "pdf" if imp.media_type == "application/pdf" else "image",
        # The app tells "taking longer than usual" from these.
        "created_at": imp.created_at.isoformat(),
        "started_at": imp.started_at.isoformat() if imp.started_at else None,
        "heartbeat": imp.heartbeat.isoformat() if imp.heartbeat else None,
        "finished_at": imp.finished_at.isoformat() if imp.finished_at else None,
        "photo_available": image is not None and image.removed_at is None,
        "photo_removed": image is not None and image.removed_at is not None,
    }
    if imp.status == ImportStatus.READY:
        draft = dict(imp.draft)
        # Duplicates are worked out now, against the invoices that exist now (one may have been
        # made since the bill was read), and listed with the other checks.
        duplicates = find_duplicates(
            imp.business,
            draft,
            draft_bill_date(draft),
            bill_number=draft.get("bill_number"),
            exclude_import_id=imp.id,
        )
        draft["checks"] = list(draft.get("checks", [])) + duplicates
        same = next((d for d in duplicates if d["code"] == "SAME_PHOTO"), None)
        draft["same_photo_invoice_id"] = same["data"]["invoice_id"] if same else None
        data["draft"] = draft
    if imp.status == ImportStatus.CONFIRMED and imp.invoice is not None:
        data["invoice_id"] = imp.invoice.id
        data["invoice_number"] = imp.invoice.number
    return data


def _read_upload(upload) -> tuple[str, bytes | None]:
    """Returns ("pdf", pdf_bytes) or ("image", None). Images are decoded (and, if bad, refused) by
    the shared image pipeline when stored; a PDF is checked here and never stored."""
    if upload.size > MAX_FILE_BYTES:
        raise ImportFileTooLarge()
    header = upload.read(5)
    upload.seek(0)
    if header != b"%PDF-":
        return "image", None
    data = upload.read()
    upload.seek(0)
    try:
        pages = len(pypdf.PdfReader(upload).pages)
    except Exception as exc:  # noqa: BLE001 - any unreadable PDF is simply refused
        raise InvalidImportFile() from exc
    upload.seek(0)
    if pages < 1:
        raise InvalidImportFile()
    if pages > MAX_PDF_PAGES:
        raise TooManyPages()
    return "pdf", data


class InvoiceImportCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.create")

        upload = request.FILES.get("file")
        if upload is None:
            raise InvalidImportFile()
        kind, pdf_bytes = _read_upload(upload)

        # The owner's daily bill-reading limit (its own bucket): over it, the import is created
        # already failed so the app shows its "limit reached" screen; nothing is stored or read.
        if not limits.check_daily_invoice_limit(business.id):
            imp = InvoiceImport.objects.create(
                business=business,
                created_by=request.user,
                status=ImportStatus.FAILED,
                error_code="DAILY_LIMIT",
                file_sha256="",
                finished_at=timezone.now(),
            )
            return Response(_payload(imp), status=202)

        fixture = ""
        if settings.AI_FAKE:
            fixture = (
                str(request.data.get("fixture", "")).strip()[:40]
                or settings.AI_FAKE_DEFAULT_FIXTURE
            )

        if kind == "pdf":
            imp = InvoiceImport.objects.create(
                business=business,
                created_by=request.user,
                media_type="application/pdf",
                file_sha256=hashlib.sha256(pdf_bytes).hexdigest(),
                temp_dir=uuid4().hex,
                fixture=fixture,
            )
            ai_files.save_temp_files(
                imp.temp_dir, [{"media_type": "application/pdf", "data": pdf_bytes}]
            )
        else:
            try:
                stored = store_image(
                    business=business,
                    user=request.user,
                    kind=StoredImageKind.IMPORTED_BILL,
                    upload=upload,
                )
            except (InvalidImage, ImageTooLarge):
                raise InvalidImportFile() from None
            imp = InvoiceImport.objects.create(
                business=business,
                created_by=request.user,
                image=stored,
                media_type="image/jpeg",
                file_sha256=stored.sha256,
                fixture=fixture,
            )

        log_action(
            user=request.user,
            action="invoice_import.create",
            business=business,
            import_id=imp.id,
            file_type=kind,
        )
        if settings.AI_FAKE:
            process_invoice_import(imp.id)
            imp.refresh_from_db()
        return Response(_payload(imp), status=202)


class InvoiceImportConfirmView(APIView):
    """POST: the owner's decisions on a ready draft become an invoice and sales, in one transaction.
    201 with the invoice; 200 when the same idempotency key already confirmed this import."""

    permission_classes = [IsAuthenticated]

    def post(self, request, business_id, import_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.create")
        invoice, created = confirm_import(
            business=business, user=request.user, import_id=import_id, data=request.data
        )
        invoice = type(invoice).objects.select_related("business", "proof").get(id=invoice.id)
        return Response(InvoiceSerializer(invoice).data, status=201 if created else 200)


class InvoiceImportDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id, import_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.create")
        imp = get_object_or_404(
            InvoiceImport.objects.select_related("image"), id=import_id, business=business
        )
        return Response(_payload(imp))

    def delete(self, request, business_id, import_id):
        """Abandons an unconfirmed import: its draft is dropped and its photo deleted."""
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.create")
        imp = get_object_or_404(
            InvoiceImport.objects.select_related("image"), id=import_id, business=business
        )
        if imp.status != ImportStatus.ABANDONED:
            now = timezone.now()
            if imp.image is not None and imp.image.removed_at is None:
                delete_file(imp.image)
                imp.image.removed_at = now
                imp.image.save(update_fields=["removed_at"])
            if imp.temp_dir:
                ai_files.delete_temp_dir(imp.temp_dir)
            imp.status = ImportStatus.ABANDONED
            imp.abandoned_at = now
            imp.draft = None
            imp.save(update_fields=["status", "abandoned_at", "draft"])
            log_action(
                user=request.user,
                action="invoice_import.abandon",
                business=business,
                import_id=imp.id,
            )
        return Response(status=204)


class InvoiceImportPhotoView(APIView):
    """Streams the stored bill photo to Owner/Manager of this business, through Django only (never
    /media), uncached. A PDF import has no photo; a purged or abandoned one says it was removed."""

    permission_classes = [IsAuthenticated]

    def get(self, request, business_id, import_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.create")
        imp = get_object_or_404(
            InvoiceImport.objects.select_related("image"), id=import_id, business=business
        )
        image = imp.image
        if image is None:
            raise PhotoRemoved() if imp.status == ImportStatus.ABANDONED else PhotoNotAvailable()
        if image.removed_at is not None:
            raise PhotoRemoved()
        try:
            handle = absolute_path(image).open("rb")
        except (FileNotFoundError, ValueError, OSError):
            raise PhotoRemoved() from None
        response = FileResponse(handle, content_type="image/jpeg")
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
