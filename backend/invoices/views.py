from datetime import date

from django.shortcuts import get_object_or_404
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.log import jsonable, log_action
from businesses.models import Business
from businesses.permissions import require_permission

from .exceptions import InvoiceValidationError
from .models import Invoice, InvoiceStatus
from .serializers import InvoiceSerializer, InvoiceSettingsSerializer
from .service import create_invoice, void_invoice

PAGE_SIZE = 50
SETTINGS_FIELDS = tuple(InvoiceSettingsSerializer().fields)


class InvoiceListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sales.create")
        qs = Invoice.objects.filter(business=business).prefetch_related("lines")
        params = request.query_params
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
    """Owner-only (`settings.manage`): flat tax on/off + rate, and the optional bill header text."""

    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "settings.manage")
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
