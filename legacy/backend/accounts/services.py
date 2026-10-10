"""Guards around role grants.

The Super Admin rules are the ones worth stating out loud, because getting them wrong locks everybody out
of the system permanently:
  - only a Super Admin may grant Super Admin;
  - at least one active Super Admin must always remain;
  - the last Super Admin cannot demote themselves.
"""

from django.db import transaction

from accounts.models import Access, User
from core.exceptions import BusinessRuleError
from core.roles import Capability, Role


def active_super_admin_count(exclude_access_id: int | None = None) -> int:
    qs = Access.objects.filter(
        role=Role.SUPER_ADMIN, active=True, business__isnull=True, user__active=True
    )
    if exclude_access_id is not None:
        qs = qs.exclude(pk=exclude_access_id)
    return qs.count()


def assert_can_grant(access, role: str) -> None:
    if role == Role.SUPER_ADMIN and not access.can(Capability.GRANT_SUPER_ADMIN):
        raise BusinessRuleError(
            "Only a Super Admin can grant Super Admin.", code="super_admin_required"
        )
    if not access.can(Capability.STAFF_MANAGE):
        raise BusinessRuleError("You cannot manage staff here.", code="forbidden_role_grant")


def assert_super_admin_remains(target_access: Access) -> None:
    """Raise if removing/deactivating `target_access` would leave zero active Super Admins."""
    if target_access.role != Role.SUPER_ADMIN or target_access.business is not None:
        return
    if active_super_admin_count(exclude_access_id=target_access.pk) == 0:
        raise BusinessRuleError(
            "At least one active Super Admin must remain. Grant Super Admin to someone else first.",
            code="last_super_admin",
        )


def assert_not_self_demotion_of_last_sa(acting_user: User, target_access: Access) -> None:
    if target_access.user_id == acting_user.pk:
        assert_super_admin_remains(target_access)


@transaction.atomic
def grant_super_admin(access, user: User) -> Access:
    """Promote `user` to global Super Admin. Idempotent — re-granting reactivates an existing row."""
    assert_can_grant(access, Role.SUPER_ADMIN)
    grant, _created = Access.objects.get_or_create(
        user=user, business=None, defaults={"role": Role.SUPER_ADMIN, "active": True}
    )
    grant.role = Role.SUPER_ADMIN
    grant.active = True
    grant.save(update_fields=["role", "active", "updated_at"])
    return grant


@transaction.atomic
def revoke_access(access, target: Access) -> None:
    assert_not_self_demotion_of_last_sa(access.user, target)
    assert_super_admin_remains(target)
    target.active = False
    target.save(update_fields=["active", "updated_at"])
