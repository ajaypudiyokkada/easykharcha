"""The only write path into AuditLog.

Every mutation in the system funnels through here so that (a) nothing can be edited without a trail and
(b) there is exactly one place where secrets are scrubbed.
"""

import datetime
from decimal import Decimal

from audit.models import AuditLog

#: Field names that must never be persisted to the audit log, whatever a serializer hands us.
SECRET_KEYS = frozenset({"pin", "pin_hash", "password", "new_pin", "current_pin", "token"})


def scrub(value):
    """Recursively drop secrets and make the payload JSON-serialisable."""
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items() if k.lower() not in SECRET_KEYS}
    if isinstance(value, list | tuple):
        return [scrub(v) for v in value]
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime.datetime | datetime.date | datetime.time):
        return value.isoformat()
    if value is None or isinstance(value, str | int | float | bool):
        return value
    return str(value)


def diff(before: dict, after: dict) -> dict:
    """Only the fields that actually changed — an audit row saying "qty 3 -> 5" beats a full dump."""
    before, after = scrub(before or {}), scrub(after or {})
    changed = {}
    for key in set(before) | set(after):
        old, new = before.get(key), after.get(key)
        if old != new:
            changed[key] = {"from": old, "to": new}
    return changed


def log(
    access,
    action: str,
    *,
    summary: str = "",
    detail: dict | None = None,
    business=None,
    user=None,
) -> AuditLog:
    return AuditLog.objects.create(
        business=business if business is not None else getattr(access, "business", None),
        user=user if user is not None else getattr(access, "user", None),
        action=action,
        summary=summary[:255],
        detail=scrub(detail or {}),
    )


def _label(instance) -> str:
    for attr in ("code", "name", "phone"):
        value = getattr(instance, attr, None)
        if value:
            return str(value)
    return f"#{getattr(instance, 'pk', '?')}"


def record_create(access, name: str, instance) -> AuditLog:
    return log(
        access,
        f"{name}.create",
        summary=f"Created {name} {_label(instance)}",
        detail={"id": getattr(instance, "pk", None), "after": _as_dict(instance)},
    )


def record_update(access, name: str, instance, before: dict, after: dict) -> AuditLog:
    return log(
        access,
        f"{name}.update",
        summary=f"Edited {name} {_label(instance)}",
        detail={"id": getattr(instance, "pk", None), "changed": diff(before, after)},
    )


def record_delete(access, name: str, instance, before: dict) -> AuditLog:
    return log(
        access,
        f"{name}.delete",
        summary=f"Deleted {name} {_label(instance)}",
        detail={"id": getattr(instance, "pk", None), "before": scrub(before)},
    )


def _as_dict(instance) -> dict:
    """Model fields as plain values. Used when no serializer representation is at hand."""
    from django.forms.models import model_to_dict

    try:
        return scrub(model_to_dict(instance))
    except Exception:  # pragma: no cover - defensive; auditing must never break a mutation
        return {"repr": str(instance)}
