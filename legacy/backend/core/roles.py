"""Roles and capabilities — the single source of truth for "who may do what".

Capabilities are **not** derived from a rank ordering, because the spec's matrix is not monotonic: a Head
Chef may raise an inventory request but a Manager may not (§1 of docs/product.md). Encoding that as
"rank >= HEAD_CHEF" would silently grant it to Managers. So each capability lists its roles explicitly and
the matrix in the spec can be diffed against this file line by line.
"""

from django.db import models


class Role(models.TextChoices):
    STAFF = "staff", "Staff"
    HEAD_CHEF = "head_chef", "Head Chef"
    MANAGER = "manager", "Manager"
    OWNER = "owner", "Owner"
    SUPER_ADMIN = "super_admin", "Super Admin"


STAFF = Role.STAFF
HEAD_CHEF = Role.HEAD_CHEF
MANAGER = Role.MANAGER
OWNER = Role.OWNER
SUPER_ADMIN = Role.SUPER_ADMIN

#: Roles a Super Admin may create on a tenant Access row. SUPER_ADMIN is excluded: it is granted
#: through the dedicated global-grant path, not by picking it from a per-tenant role dropdown.
TENANT_ROLES = (STAFF, HEAD_CHEF, MANAGER, OWNER)


class Capability:
    """String constants for the things a role may do. Used as `required_capability` on views."""

    WASTAGE_ADD = "wastage.add"
    STOCK_CAPTURE = "stock.capture"
    RECEIVE_GOODS = "receive.add"
    REQUEST_RAISE = "request.raise"
    REQUEST_FULFIL = "request.fulfil"
    SALES_RECORD = "sales.record"

    CONFIG_ADD = "config.add"
    CONFIG_EDIT = "config.edit"

    STAFF_MANAGE = "staff.manage"
    GRANT_SUPER_ADMIN = "staff.grant_super_admin"

    TENANT_CREATE = "tenant.create"
    TENANT_SETTINGS = "tenant.settings"

    REPORTS_VIEW = "reports.view"
    ENTRY_EDIT = "entry.edit"
    AUDIT_VIEW = "audit.view"
    AUDIT_VIEW_ALL = "audit.view_all"
    TEMPLATE_MANAGE = "template.manage"

    #: Non-negotiable #4 (blind counts). Roles that record physical quantities must never be shown
    #: sales, expected usage, variance or a computed closing figure — seeing the target invites
    #: writing the count to match it.
    SEE_SALES = "visibility.sales"
    SEE_VARIANCE = "visibility.variance"


ALL = frozenset({STAFF, HEAD_CHEF, MANAGER, OWNER, SUPER_ADMIN})
CHEF_UP = frozenset({HEAD_CHEF, MANAGER, OWNER, SUPER_ADMIN})
MANAGER_UP = frozenset({MANAGER, OWNER, SUPER_ADMIN})
OWNER_UP = frozenset({OWNER, SUPER_ADMIN})
SA_ONLY = frozenset({SUPER_ADMIN})

CAPABILITIES: dict[str, frozenset] = {
    Capability.WASTAGE_ADD: ALL,
    Capability.STOCK_CAPTURE: CHEF_UP,
    Capability.RECEIVE_GOODS: CHEF_UP,
    # Deliberately not MANAGER: the chef asks, the manager buys. See the matrix in §1.
    Capability.REQUEST_RAISE: frozenset({HEAD_CHEF, OWNER, SUPER_ADMIN}),
    Capability.REQUEST_FULFIL: MANAGER_UP,
    Capability.SALES_RECORD: MANAGER_UP,
    Capability.CONFIG_ADD: MANAGER_UP,
    Capability.CONFIG_EDIT: OWNER_UP,
    Capability.STAFF_MANAGE: OWNER_UP,
    Capability.GRANT_SUPER_ADMIN: SA_ONLY,
    Capability.TENANT_CREATE: OWNER_UP,
    Capability.TENANT_SETTINGS: OWNER_UP,
    Capability.REPORTS_VIEW: OWNER_UP,
    Capability.ENTRY_EDIT: OWNER_UP,
    Capability.AUDIT_VIEW: OWNER_UP,
    Capability.AUDIT_VIEW_ALL: SA_ONLY,
    Capability.TEMPLATE_MANAGE: SA_ONLY,
    Capability.SEE_SALES: MANAGER_UP,
    Capability.SEE_VARIANCE: OWNER_UP,
}


def can(role: str, capability: str) -> bool:
    """True if `role` holds `capability`. Unknown capabilities deny rather than allow."""
    return role in CAPABILITIES.get(capability, frozenset())


def capabilities_for(role: str) -> list[str]:
    """Every capability a role holds — sent to the client so nav and buttons match the server."""
    return sorted(name for name, roles in CAPABILITIES.items() if role in roles)
