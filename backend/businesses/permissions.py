"""The one place roles are defined. Every business-scoped endpoint checks a permission string here —
never a role name directly — so a new role, or a role gaining/losing a permission, is a one-line change
in this table, not a hunt through every view.

ALL_PERMISSIONS is the single registry every permission string must come from. The Owner's set is
computed as ALL_PERMISSIONS, not hand-listed, so a permission that exists for any role — including one
added later — reaches the Owner for free, and an "own"/"all" pair (wastage.view_own/view_all) lands on
the Owner together. Manager/Head chef/Helper keep their own hand-picked subsets below; a role listing a
permission that isn't in ALL_PERMISSIONS fails at import time (see the check right after the table).

Step 9 drafted purchases + stock viewing. Step 10 adds counts and wastage: Head chef and Helper now
have real jobs (blind stock counts, recording wastage) instead of an empty placeholder Home. See
docs/STATUS.md for the full table and the reasoning behind each role's set.
"""

from rest_framework.exceptions import PermissionDenied

from .models import Access, AccessRole, Business

ALL_PERMISSIONS: frozenset[str] = frozenset(
    {
        "purchases.view",
        "purchases.create",
        "purchases.edit",
        "purchases.delete",
        "stock.view",
        "stockitems.manage",
        "stockitems.thresholds_manage",
        "stock.low_stock_view",
        "sellitems.manage",
        "business.manage",
        "settings.manage",
        "team.manage",
        "team.view",
        "counts.create",
        "counts.review",
        "counts.status",
        "wastage.create",
        "wastage.view_all",
        "wastage.view_own",
        "wastage.view_value",
        "wastage.delete",
        "sales.view",
        "sales.create",
        "sales.delete",
        "alerts.view",
        "alerts.check",
        "reports.view",
    }
)

_LOWER_ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    AccessRole.MANAGER: frozenset(
        {
            "purchases.view",
            "purchases.create",
            "stock.view",
            "stockitems.thresholds_manage",
            "stock.low_stock_view",
            "counts.review",
            "wastage.view_all",
            "wastage.view_value",
            "team.view",
            "sales.view",
            "sales.create",
            "alerts.view",
            "alerts.check",
            "reports.view",
        }
    ),
    AccessRole.HEAD_CHEF: frozenset(
        {
            "counts.create",
            "counts.status",
            "wastage.create",
            "wastage.view_all",
            "stock.low_stock_view",
        }
    ),
    AccessRole.HELPER: frozenset(
        {
            "counts.create",
            "wastage.create",
            "wastage.view_own",
        }
    ),
}

for _role, _perms in _LOWER_ROLE_PERMISSIONS.items():
    _unknown = _perms - ALL_PERMISSIONS
    if _unknown:
        raise ValueError(f"{_role} lists permission(s) not in ALL_PERMISSIONS: {sorted(_unknown)}")
del _role, _perms, _unknown

PERMISSIONS: dict[str, frozenset[str]] = {
    AccessRole.OWNER: ALL_PERMISSIONS,
    **_LOWER_ROLE_PERMISSIONS,
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
