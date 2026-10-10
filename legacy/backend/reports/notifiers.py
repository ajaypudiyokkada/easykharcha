"""Outbound alert delivery, behind an interface.

Only a logging no-op ships. WhatsApp needs a BSP (Gupshup / Interakt / Twilio) and credentials that
nobody has chosen yet (docs/DECISIONS.md O-7), and WhatsApp *group* automation is not feasible at all:
Meta's Cloud API caps business-created groups at 8 participants. So the real implementation will be
1:1 messages to Owners, and that decision is deferred rather than guessed at here.
"""

import logging

logger = logging.getLogger(__name__)


class Notifier:
    """Send one alert bundle to one recipient."""

    name = "base"

    def send(self, *, to: str, subject: str, body: str, meta: dict | None = None) -> bool:
        raise NotImplementedError


class LoggingNotifier(Notifier):
    """The default. Writes what *would* have been sent, so the sweep is testable end to end."""

    name = "logging"

    def send(self, *, to: str, subject: str, body: str, meta: dict | None = None) -> bool:
        logger.info("[notify:%s] %s — %s", to, subject, body.replace("\n", " | "))
        return True


class WhatsAppBSPNotifier(Notifier):
    """Placeholder. Raises rather than silently doing nothing, so wiring it up cannot be forgotten."""

    name = "whatsapp"

    def send(self, *, to: str, subject: str, body: str, meta: dict | None = None) -> bool:
        raise NotImplementedError(
            "No WhatsApp BSP is configured yet — see docs/DECISIONS.md O-7. "
            "Set ALERT_NOTIFIER=logging until a provider is chosen."
        )


_REGISTRY = {n.name: n for n in (LoggingNotifier, WhatsAppBSPNotifier)}


def get_notifier() -> Notifier:
    from django.conf import settings

    name = getattr(settings, "ALERT_NOTIFIER", "logging")
    return _REGISTRY.get(name, LoggingNotifier)()


def whatsapp_share_link(phone: str, text: str) -> str:
    """`wa.me` deep link for the Report's "Share summary" button — a user action, not automation."""
    from urllib.parse import quote

    digits = "".join(ch for ch in phone if ch.isdigit())
    return f"https://wa.me/{digits}?text={quote(text)}"
