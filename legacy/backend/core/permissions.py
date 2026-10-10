"""Permission classes.

Non-negotiable #2 lives in `CapabilityPermission`: the capability required depends on the HTTP method, so
"anyone with the role may create, only Owner/SA may edit or delete" is enforced once, centrally, instead
of being re-remembered in each view.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission

from core.roles import Capability


class IsAuthenticatedActive(BasePermission):
    message = "Account is inactive."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.active)


class CapabilityPermission(BasePermission):
    """Checks the view's declared capabilities against the caller's live role at the tenant.

    Views declare any of:
      - `read_capability`    — required for GET/HEAD/OPTIONS (default: none, any tenant member)
      - `create_capability`  — required for POST
      - `write_capability`   — required for PUT/PATCH/DELETE (default: Capability.ENTRY_EDIT)
    """

    read_capability: str | None = None
    create_capability: str | None = None
    write_capability: str | None = Capability.ENTRY_EDIT

    def has_permission(self, request, view):
        access = getattr(view, "access", None)
        if access is None:
            return False

        capability = self._capability_for(request, view)
        if capability is None:
            return True
        if access.can(capability):
            return True
        self.message = (
            f"Your role ({access.role}) cannot do this. "
            "Creating is allowed by role; editing and deleting are Owner/Super Admin actions."
        )
        return False

    @staticmethod
    def _capability_for(request, view) -> str | None:
        if request.method in SAFE_METHODS:
            return getattr(view, "read_capability", None)
        if request.method == "POST":
            return getattr(view, "create_capability", None)
        return getattr(view, "write_capability", Capability.ENTRY_EDIT)
