"""The one place roles are defined. Every business-scoped endpoint checks a permission string here —
never a role name directly — so a new role, or a role gaining/losing a permission, is a one-line change
in this table, not a hunt through every view.

This is the starting table for Step 9 (purchases + stock viewing only). Head chef and Helper have no
permissions yet on purpose — their jobs (counting stock, recording wastage) don't exist as features
yet, so there's nothing to grant them access to. See docs/STATUS.md: this table is a first draft for
the product owner to review, not a final design.
"""

from rest_framework.exceptions import PermissionDenied

from .models import Access, AccessRole, Business

PERMISSIONS: dict[str, frozenset[str]] = {
    AccessRole.OWNER: frozenset(
        {
            "purchases.view",
            "purchases.create",
            "purchases.edit",
            "purchases.delete",
            "stock.view",
            "team.manage",
            "settings.manage",
        }
    ),
    AccessRole.MANAGER: frozenset({"purchases.view", "purchases.create", "stock.view"}),
    AccessRole.HEAD_CHEF: frozenset(),
    AccessRole.HELPER: frozenset(),
}


def permissions_for(role: str | None) -> frozenset[str]:
    if role is None:
        return frozenset()
    return PERMISSIONS.get(role, frozenset())


def access_or_403(business: Business, user) -> Access:
    """Looked up fresh on every call — never cached — so a role change takes effect immediately."""
    access = Access.objects.filter(user=user, business=business).first()
    if not access:
        raise PermissionDenied()
    return access


def require_permission(business: Business, user, permission: str) -> Access:
    """The one gate every business-scoped endpoint should call. Raises 403 both when the user has no
    access to the business at all, and when their role doesn't carry this permission — the response
    is identical either way, so a non-member can't tell a permission from a nonexistent one."""
    access = access_or_403(business, user)
    if permission not in permissions_for(access.role):
        raise PermissionDenied()
    return access
