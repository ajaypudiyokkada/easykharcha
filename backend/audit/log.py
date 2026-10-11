from accounts.models import User

from .models import AuditLog


def log_action(*, user: User | None, action: str, business=None, **metadata) -> None:
    """Records an audit entry. `metadata` is stored as-is in a JSON column — never pass a password,
    token, or other secret in it."""
    AuditLog.objects.create(user=user, business=business, action=action, metadata=metadata)
