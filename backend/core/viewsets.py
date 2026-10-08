"""Base viewsets that apply tenancy, capabilities and auditing to every endpoint.

A view that subclasses `TenantScopedViewSet` cannot accidentally leak another tenant's rows: the queryset
is filtered in `get_queryset()` here, and `self.access` is resolved in `initial()` before any handler runs.
"""

from rest_framework import viewsets
from rest_framework.generics import GenericAPIView
from rest_framework.views import APIView

from audit.services import record_create, record_delete, record_update
from core.permissions import CapabilityPermission, IsAuthenticatedActive
from core.tenancy import resolve_access


class TenantAccessMixin:
    """Resolves `self.access` from the `tenant_id` URL kwarg before the handler runs."""

    permission_classes = [IsAuthenticatedActive, CapabilityPermission]
    tenant_url_kwarg = "tenant_id"

    def initial(self, request, *args, **kwargs):
        # Authentication must happen before we can resolve a role, but permission checks need the role.
        # DRF's initial() runs perform_authentication -> check_permissions, so resolving in between is
        # not possible; instead we authenticate here explicitly and then resolve.
        self.perform_authentication(request)
        self.access = (
            resolve_access(request.user, self.kwargs[self.tenant_url_kwarg])
            if request.user and request.user.is_authenticated
            else None
        )
        super().initial(request, *args, **kwargs)

    @property
    def business(self):
        return self.access.business

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["access"] = getattr(self, "access", None)
        context["business"] = self.access.business if getattr(self, "access", None) else None
        return context


class TenantScopedViewSet(TenantAccessMixin, viewsets.ModelViewSet):
    """ModelViewSet for a tenant-scoped model.

    Subclasses set `queryset`, `serializer_class` and the capability attributes. They should not override
    `get_queryset` without calling super() — that filter is the tenant isolation guarantee.
    """

    #: The audit `action` prefix, e.g. "wastage" -> wastage.create / wastage.update / wastage.delete
    audit_name: str = ""

    def get_queryset(self):
        return super().get_queryset().filter(business=self.access.business)

    def perform_create(self, serializer):
        instance = serializer.save(business=self.access.business)
        record_create(self.access, self.audit_name or self._default_audit_name(), instance)
        return instance

    def perform_update(self, serializer):
        before = self.get_serializer(serializer.instance).data
        instance = serializer.save()
        after = self.get_serializer(instance).data
        record_update(
            self.access, self.audit_name or self._default_audit_name(), instance, before, after
        )
        return instance

    def perform_destroy(self, instance):
        before = self.get_serializer(instance).data
        record_delete(self.access, self.audit_name or self._default_audit_name(), instance, before)
        instance.delete()

    def _default_audit_name(self) -> str:
        return self.queryset.model._meta.model_name


class TenantAPIView(TenantAccessMixin, APIView):
    """Plain APIView with tenancy resolved — for endpoints that are not CRUD over one model."""


class TenantGenericAPIView(TenantAccessMixin, GenericAPIView):
    pass
