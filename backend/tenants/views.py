from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Access, User
from accounts.serializers import AccessSerializer, AccessWriteSerializer
from accounts.services import assert_can_grant, grant_super_admin, revoke_access
from audit.services import log, record_update
from core.exceptions import BusinessRuleError
from core.permissions import IsAuthenticatedActive
from core.roles import Capability, Role, capabilities_for
from core.tenancy import accessible_businesses, global_super_admin_access
from core.viewsets import TenantAPIView
from inventory.models import Dish, Ingredient, Vendor
from inventory.serializers import DishSerializer, IngredientSerializer, VendorSerializer
from tenants.models import Business
from tenants.serializers import BusinessCreateSerializer, BusinessSerializer
from tenants.services import create_business


class MyTenantsView(APIView):
    permission_classes = [IsAuthenticatedActive]

    def get(self, request):
        businesses = accessible_businesses(request.user)
        from core.tenancy import role_at

        return Response(
            [
                {
                    **BusinessSerializer(business, context={"request": request}).data,
                    "role": role_at(request.user, business.id),
                }
                for business in businesses
            ]
        )


class TenantCreateView(APIView):
    permission_classes = [IsAuthenticatedActive]

    def post(self, request):
        """Any Owner or Super Admin may create a tenant; a Staff/Chef/Manager may not (§1)."""
        is_sa = global_super_admin_access(request.user) is not None
        owns_something = Access.objects.filter(
            user=request.user, role=Role.OWNER, active=True
        ).exists()
        if not (is_sa or owns_something):
            raise BusinessRuleError(
                "Only an Owner or Super Admin can add a business.", code="forbidden"
            )

        serializer = BusinessCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        seed = data.pop("seed_from_fomo", False)

        source = None
        if seed:
            source = Business.objects.filter(name__iexact="FOMO").first()
            if source is None:
                raise BusinessRuleError(
                    "No business named FOMO exists to copy from. Run `seed_fomo` first, or create "
                    "this business without the starter data.",
                    code="no_seed_source",
                )

        from core.tenancy import AccessContext

        access = AccessContext(
            user=request.user,
            business=None,
            role=Role.SUPER_ADMIN if is_sa else Role.OWNER,
            is_global=is_sa,
        )
        business = create_business(access, data, seed_from=source)
        return Response(
            BusinessSerializer(business, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class TenantSettingsView(TenantAPIView):
    """Branding, thresholds and SLA. Read by anyone in the tenant; written by Owner/SA only."""

    read_capability = None
    write_capability = Capability.TENANT_SETTINGS
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request, *args, **kwargs):
        return Response(BusinessSerializer(self.access.business, context={"request": request}).data)

    def patch(self, request, *args, **kwargs):
        business = self.access.business
        before = BusinessSerializer(business, context={"request": request}).data
        serializer = BusinessSerializer(
            business, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        after = BusinessSerializer(updated, context={"request": request}).data
        record_update(self.access, "business", updated, before, after)
        return Response(after)


class TenantBootstrapView(TenantAPIView):
    """One call that gives the shell everything it needs to render: role, branding, catalogue, alerts.

    Deliberately a single round trip — restaurant wifi is bad, and five sequential requests on a phone
    at the back of a kitchen is a visibly slow app.
    """

    def get(self, request, *args, **kwargs):
        from reports.services import sla_alerts

        business = self.access.business
        context = {"access": self.access, "business": business, "request": request}

        payload = {
            "business": BusinessSerializer(business, context=context).data,
            "role": self.access.role,
            "role_label": dict(Role.choices).get(self.access.role, self.access.role),
            "capabilities": capabilities_for(self.access.role),
            "ingredients": IngredientSerializer(
                Ingredient.objects.filter(business=business).select_related("vendor", "canonical"),
                many=True,
                context=context,
            ).data,
            "vendors": VendorSerializer(
                Vendor.objects.filter(business=business), many=True, context=context
            ).data,
            "alerts": sla_alerts(business, timezone.localtime()),
            "today": timezone.localdate(),
        }
        # Dishes drive the Sales screen; a role that cannot see sales does not need the menu either.
        if self.access.can(Capability.SEE_SALES) or self.access.can(Capability.CONFIG_ADD):
            payload["dishes"] = DishSerializer(
                Dish.objects.filter(business=business).select_related("ing"),
                many=True,
                context=context,
            ).data
        else:
            payload["dishes"] = []
        return Response(payload)


class TenantAccessView(TenantAPIView):
    """Staff list and role grants for one tenant."""

    read_capability = Capability.STAFF_MANAGE
    create_capability = Capability.STAFF_MANAGE
    write_capability = Capability.STAFF_MANAGE

    def get(self, request, *args, **kwargs):
        rows = (
            Access.objects.filter(business=self.access.business)
            .select_related("user")
            .order_by("user__name")
        )
        payload = AccessSerializer(rows, many=True).data
        if self.access.is_super_admin:
            # Super Admins are global, so they do not appear in any tenant's Access rows. Showing them
            # here is the only way an SA can see who else holds the keys.
            payload += [
                {**AccessSerializer(row).data, "global": True}
                for row in Access.objects.filter(
                    business__isnull=True, role=Role.SUPER_ADMIN
                ).select_related("user")
            ]
        return Response(payload)

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        serializer = AccessWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        role = data["role"]
        assert_can_grant(self.access, role)

        user, created = User.objects.get_or_create(
            phone=data["phone"].strip(), defaults={"name": data.get("name", "")}
        )
        if created:
            pin = data.get("pin")
            if not pin:
                raise BusinessRuleError(
                    "This phone number is new, so set a starting PIN. "
                    "They will be asked to change it on first login.",
                    code="pin_required",
                )
            user.set_pin(pin)
            user.must_change_pin = True
            user.name = data.get("name", "") or user.name
            user.save()
        elif data.get("name"):
            user.name = data["name"]
            user.save(update_fields=["name", "updated_at"])

        if role == Role.SUPER_ADMIN:
            grant = grant_super_admin(self.access, user)
            log(
                self.access,
                "access.grant_super_admin",
                summary=f"Granted Super Admin to {user.phone}",
                detail={"user": user.phone},
            )
            return Response(AccessSerializer(grant).data, status=status.HTTP_201_CREATED)

        grant, _ = Access.objects.get_or_create(
            business=self.access.business, user=user, defaults={"role": role}
        )
        grant.role = role
        grant.active = True
        grant.save(update_fields=["role", "active", "updated_at"])
        log(
            self.access,
            "access.grant",
            summary=f"Granted {role} to {user.phone} at {self.access.business.name}",
            detail={"user": user.phone, "role": role},
        )
        return Response(AccessSerializer(grant).data, status=status.HTTP_201_CREATED)


class TenantAccessDetailView(TenantAPIView):
    read_capability = Capability.STAFF_MANAGE
    write_capability = Capability.STAFF_MANAGE

    def _get(self, pk):
        from django.db.models import Q

        return get_object_or_404(
            Access.objects.select_related("user").filter(
                Q(business=self.access.business) | Q(business__isnull=True)
            ),
            pk=pk,
        )

    def patch(self, request, tenant_id, pk, *args, **kwargs):
        grant = self._get(pk)
        role = request.data.get("role", grant.role)
        active = request.data.get("active", grant.active)
        assert_can_grant(self.access, role)

        if grant.role == Role.SUPER_ADMIN and (role != Role.SUPER_ADMIN or active is False):
            from accounts.services import (
                assert_not_self_demotion_of_last_sa,
                assert_super_admin_remains,
            )

            assert_not_self_demotion_of_last_sa(self.access.user, grant)
            assert_super_admin_remains(grant)

        before = AccessSerializer(grant).data
        grant.role = role
        grant.active = bool(active)
        grant.save(update_fields=["role", "active", "updated_at"])
        record_update(self.access, "access", grant, before, AccessSerializer(grant).data)
        return Response(AccessSerializer(grant).data)

    def delete(self, request, tenant_id, pk, *args, **kwargs):
        grant = self._get(pk)
        revoke_access(self.access, grant)
        log(
            self.access,
            "access.revoke",
            summary=f"Revoked {grant.role} from {grant.user.phone}",
            detail={"user": grant.user.phone, "role": grant.role},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
