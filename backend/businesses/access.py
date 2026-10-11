from rest_framework.exceptions import PermissionDenied

from .models import Access, AccessRole, Business


def owner_access_or_403(business: Business, user) -> Access:
    """Looked up fresh on every call — never cached — so a role change takes effect immediately."""
    access = Access.objects.filter(user=user, business=business).first()
    if not access or access.role != AccessRole.OWNER:
        raise PermissionDenied()
    return access
