from decimal import Decimal

from accounts.models import User

from .models import AuditLog


def log_action(*, user: User | None, action: str, business=None, **metadata) -> None:
    """Records an audit entry. `metadata` is stored as-is in a JSON column — never pass a password,
    token, or other secret in it."""
    AuditLog.objects.create(user=user, business=business, action=action, metadata=metadata)


def jsonable(value):
    """Coerces one model field value into something a plain JSONField can store, for before/after
    audit snapshots — a Decimal or a related model instance (a foreign key) isn't JSON-serialisable
    as-is."""
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, "pk"):
        return value.pk
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value
