from rest_framework import serializers
from rest_framework.response import Response

from audit.models import AuditLog
from core.pagination import DefaultPagination
from core.roles import Capability
from core.viewsets import TenantAPIView


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    business_name = serializers.CharField(source="business.name", read_only=True)

    class Meta:
        model = AuditLog
        fields = (
            "id",
            "at",
            "business",
            "business_name",
            "user",
            "user_name",
            "action",
            "summary",
            "detail",
        )

    def get_user_name(self, obj) -> str | None:
        return (obj.user.name or obj.user.phone) if obj.user else None


class AuditView(TenantAPIView):
    """Owner sees their own tenant; a Super Admin can toggle to every tenant at once (§6)."""

    read_capability = Capability.AUDIT_VIEW

    def get(self, request, *args, **kwargs):
        scope = request.query_params.get("scope", "this")
        queryset = AuditLog.objects.select_related("user", "business")

        if scope == "all":
            if not self.access.can(Capability.AUDIT_VIEW_ALL):
                # An Owner asking for "all" gets their own tenant rather than an error — the toggle
                # simply isn't theirs to use, and failing the whole request would be unhelpful.
                queryset = queryset.filter(business=self.access.business)
                scope = "this"
        else:
            queryset = queryset.filter(business=self.access.business)

        action = request.query_params.get("action")
        if action:
            queryset = queryset.filter(action__startswith=action)

        paginator = DefaultPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        data = AuditLogSerializer(page, many=True).data
        response = paginator.get_paginated_response(data)
        response.data["scope"] = scope
        return Response(response.data)
