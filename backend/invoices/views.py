from datetime import date

from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.log import jsonable, log_action
from businesses.models import Business
from businesses.permissions import require_permission

from .exceptions import InvoiceValidationError, ProofNotAvailable, ProofRemoved
from .images import absolute_path, store_image
from .import_views import PhotoNotAvailable, PhotoRemoved
from .models import (
    Invoice,
    InvoiceSource,
    InvoiceStatus,
    PaymentStatus,
    StoredImage,
    StoredImageKind,
)
from .payment import mark_paid, mark_unpaid
from .serializers import InvoiceSerializer, InvoiceSettingsSerializer
from .service import create_invoice, void_invoice

PAGE_SIZE = 50
SETTINGS_FIELDS = tuple(InvoiceSettingsSerializer().fields)


class InvoiceListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.create")
        qs = (
            Invoice.objects.filter(business=business)
            .select_related("business", "proof", "invoice_import__image")
            .prefetch_related("lines")
        )
        params = request.query_params
        if params.get("source"):
            if params["source"] not in InvoiceSource.values:
                raise InvoiceValidationError({"source": "Use created or imported."})
            qs = qs.filter(source=params["source"])
        if params.get("payment_status"):
            if params["payment_status"] not in PaymentStatus.values:
                raise InvoiceValidationError({"payment_status": "Use paid or unpaid."})
            qs = qs.filter(payment_status=params["payment_status"])
        if params.get("status"):
            if params["status"] not in InvoiceStatus.values:
                raise InvoiceValidationError({"status": "Use posted or void."})
            qs = qs.filter(status=params["status"])
        for param, lookup in (
            ("date", "sale_date"),
            ("date_from", "sale_date__gte"),
            ("date_to", "sale_date__lte"),
        ):
            if params.get(param):
                try:
                    qs = qs.filter(**{lookup: date.fromisoformat(params[param])})
                except ValueError:
                    raise InvoiceValidationError({param: "Use a date like 2026-11-20."}) from None
        paginator = PageNumberPagination()
        paginator.page_size = PAGE_SIZE
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(InvoiceSerializer(page, many=True).data)

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.create")
        invoice, created = create_invoice(business=business, user=request.user, data=request.data)
        return Response(InvoiceSerializer(invoice).data, status=201 if created else 200)


class InvoiceDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id, iid):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.create")
        invoice = get_object_or_404(Invoice, id=iid, business=business)
        return Response(InvoiceSerializer(invoice).data)


class InvoiceVoidView(APIView):
    """Owner-only (`sales.delete` is held by the Owner alone). The reason is optional. Voiding an
    already-void invoice just returns it (200)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, business_id, iid):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.delete")
        invoice = get_object_or_404(Invoice, id=iid, business=business)
        reason = str(request.data.get("reason", "")).strip()
        if len(reason) > 200:
            raise InvoiceValidationError({"reason": "Keep the reason under 200 characters."})
        voided = void_invoice(invoice=invoice, user=request.user, reason=reason)
        return Response(InvoiceSerializer(voided).data)


class InvoiceSettingsView(APIView):
    """Flat tax on/off + rate, and the optional bill header text. Anyone who can create an invoice
    (Owner, Manager: `sales.create`) can READ these, since the bill form needs the tax rate; only
    the Owner (`settings.manage`) can change them."""

    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.create")
        return Response(self._data(business.settings))

    def patch(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "settings.manage")
        serializer = InvoiceSettingsSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        row = business.settings
        changed = list(serializer.validated_data)
        before = {f: jsonable(getattr(row, f)) for f in changed}
        for field, value in serializer.validated_data.items():
            setattr(row, field, value)
        row.save(update_fields=changed)
        log_action(
            user=request.user,
            action="invoice_settings.update",
            business=business,
            before=before,
            after={f: jsonable(getattr(row, f)) for f in changed},
        )
        return Response(self._data(row))

    @staticmethod
    def _data(row) -> dict:
        return InvoiceSettingsSerializer({f: getattr(row, f) for f in SETTINGS_FIELDS}).data


class PaymentProofUploadView(APIView):
    """Uploads a payment proof photo (multipart field "image"). It is stored unattached; an invoice
    claims it when it is created as paid or marked paid. Unclaimed proofs are purged after a day."""

    permission_classes = [IsAuthenticated]

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.create")
        upload = request.FILES.get("image")
        if upload is None:
            raise InvoiceValidationError({"image": "Please choose a photo."})
        stored = store_image(
            business=business,
            user=request.user,
            kind=StoredImageKind.PAYMENT_PROOF,
            upload=upload,
        )
        already_used = StoredImage.objects.filter(
            business=business, sha256=stored.sha256, invoices__isnull=False
        ).exists()
        return Response({"proof_id": stored.id, "proof_already_used": already_used}, status=201)


class InvoiceProofView(APIView):
    """Streams the payment proof, only to Owner/Manager of this invoice's business. Served through
    Django, never from the public /media path; the response must not be cached."""

    permission_classes = [IsAuthenticated]

    def get(self, request, business_id, iid):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.create")
        invoice = get_object_or_404(
            Invoice.objects.select_related("proof"), id=iid, business=business
        )
        proof = invoice.proof
        if proof is None:
            raise ProofNotAvailable()
        if proof.removed_at is not None:
            raise ProofRemoved()
        try:
            handle = absolute_path(proof).open("rb")
        except (FileNotFoundError, ValueError, OSError):
            raise ProofRemoved() from None
        response = FileResponse(handle, content_type="image/jpeg")
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response


class InvoiceMarkPaidView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, business_id, iid):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.create")
        invoice = get_object_or_404(
            Invoice.objects.select_related("business", "proof"), id=iid, business=business
        )
        paid, _changed = mark_paid(invoice=invoice, user=request.user, raw=request.data)
        return Response(InvoiceSerializer(paid).data)


class InvoiceMarkUnpaidView(APIView):
    """Owner only (`sales.delete`), for correcting a mistake."""

    permission_classes = [IsAuthenticated]

    def post(self, request, business_id, iid):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.delete")
        invoice = get_object_or_404(
            Invoice.objects.select_related("business", "proof"), id=iid, business=business
        )
        unpaid, _changed = mark_unpaid(invoice=invoice, user=request.user)
        return Response(InvoiceSerializer(unpaid).data)


class InvoiceBillPhotoView(APIView):
    """The stored photo of the bill an imported invoice came from. Owner/Manager of this business,
    through Django only (never /media), uncached. A created invoice, or an import that was a PDF,
    has none; after retention it is "removed"."""

    permission_classes = [IsAuthenticated]

    def get(self, request, business_id, iid):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.create")
        invoice = get_object_or_404(
            Invoice.objects.select_related("invoice_import__image"), id=iid, business=business
        )
        record = getattr(invoice, "invoice_import", None)
        image = record.image if record is not None else None
        if image is None:
            raise PhotoNotAvailable()
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
