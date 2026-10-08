"""Resolving which tenant a request is about, and what the caller may do there.

Non-negotiable #3: the role is read from the Access table on **every** request. It is never cached on the
token, the session, or the user object, so revoking a grant takes effect on the next call rather than at
token expiry.
"""

from dataclasses import dataclass

from django.http import Http404
from django.shortcuts import get_object_or_404

from core import roles as role_defs
from core.roles import Capability, Role


@dataclass(frozen=True)
class AccessContext:
    """The caller's standing at one tenant, resolved fresh per request."""

    user: object
    business: object
    role: str
    #: True when the role comes from a global Access row (tenant is null) rather than a grant on this
    #: tenant. A global Super Admin reaches every tenant without holding a row per tenant.
    is_global: bool

    @property
    def is_super_admin(self) -> bool:
        return self.role == Role.SUPER_ADMIN

    def can(self, capability: str) -> bool:
        return role_defs.can(self.role, capability)

    @property
    def capabilities(self) -> list[str]:
        return role_defs.capabilities_for(self.role)


def global_super_admin_access(user) -> object | None:
    from accounts.models import Access

    return (
        Access.objects.filter(user=user, business__isnull=True, role=Role.SUPER_ADMIN, active=True)
        .select_related("user")
        .first()
    )


def resolve_access(user, business_id) -> AccessContext:
    """The caller's AccessContext at `business_id`, or 404 if they have no business knowing it exists.

    404 rather than 403 is deliberate: a Manager at tenant A probing tenant B's ids should not be able to
    tell an existing tenant from a non-existent one.
    """
    from accounts.models import Access
    from tenants.models import Business

    if not getattr(user, "is_authenticated", False) or not user.active:
        raise Http404

    sa = global_super_admin_access(user)
    if sa is not None:
        business = get_object_or_404(Business, pk=business_id)
        return AccessContext(user=user, business=business, role=Role.SUPER_ADMIN, is_global=True)

    access = (
        Access.objects.filter(user=user, business_id=business_id, active=True)
        .select_related("business")
        .first()
    )
    if access is None or access.business is None or access.business.status != "active":
        raise Http404
    return AccessContext(user=user, business=access.business, role=access.role, is_global=False)


def accessible_businesses(user):
    """Every tenant the caller may act on. A global Super Admin gets all active tenants."""
    from accounts.models import Access
    from tenants.models import Business

    if not getattr(user, "is_authenticated", False) or not user.active:
        return Business.objects.none()
    if global_super_admin_access(user) is not None:
        return Business.objects.filter(status="active").order_by("name")
    business_ids = Access.objects.filter(
        user=user, active=True, business__isnull=False
    ).values_list("business_id", flat=True)
    return Business.objects.filter(id__in=business_ids, status="active").order_by("name")


def role_at(user, business_id) -> str | None:
    """The caller's role at a tenant, or None. Does not raise — for serializer-level visibility checks."""
    try:
        return resolve_access(user, business_id).role
    except Http404:
        return None


__all__ = [
    "AccessContext",
    "Capability",
    "accessible_businesses",
    "global_super_admin_access",
    "resolve_access",
    "role_at",
]
