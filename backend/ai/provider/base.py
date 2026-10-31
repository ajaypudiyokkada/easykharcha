"""Shared by both providers: the parse-validate-fallback contract described in Step C1's spec. A
provider only has to supply get_raw (how to get one attempt's raw tool input) and parse (how to
validate and sanitise it) — the retry-once-on-the-fallback-model logic lives here exactly once.

Step EK-4a2: a provider-call failure (network/429/529/timeout — AiProviderCallError) is retried once
more on the SAME model after a short backoff before falling back to fallback_model, since the SDK's
own retry budget can still be exhausted under sustained load; a schema-validation failure skips
straight to the fallback (retrying the same model won't change what it already decided to say).
Every failed attempt is logged (stage/label/model/exception/status — never the raw prompt/response)
so a later ai_provider_error has something to diagnose."""

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass

from django.conf import settings

from .errors import AiProviderCallError, AiSchemaError

logger = logging.getLogger(__name__)

_RETRY_BACKOFF_SECONDS = 2.0


@dataclass
class AiCallResult:
    data: dict
    model: str
    input_tokens: int
    output_tokens: int
    used_fallback: bool = False
    truncated: bool = False


def _attempt(
    get_raw: Callable[[int, str], tuple[dict, str, int, int, bool]],
    parse: Callable[[dict], dict],
    attempt: int,
    model: str,
) -> tuple[AiCallResult | None, Exception | None, bool]:
    try:
        raw, used_model, input_tokens, output_tokens, truncated = get_raw(attempt, model)
    except AiProviderCallError as exc:
        return None, exc, False
    try:
        data = parse(raw)
    except Exception as exc:  # noqa: BLE001 - any validation failure falls back the same way
        return None, exc, truncated
    return (
        AiCallResult(
            data=data,
            model=used_model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            truncated=truncated,
        ),
        None,
        truncated,
    )


def _log_failure(
    stage: str, label: str, model: str, attempt: int, exc: Exception, truncated: bool
) -> None:
    status = getattr(exc, "status_code", None)
    exc_type = getattr(exc, "exc_type", "") or type(exc).__name__
    logger.warning(
        "ai_call_failed stage=%s label=%s model=%s attempt=%s exc_type=%s status=%s "
        "max_tokens_hit=%s msg=%s",
        stage,
        label,
        model,
        attempt,
        exc_type,
        status,
        truncated,
        str(exc)[:500],
    )


def run_with_fallback(
    *,
    primary_model: str,
    fallback_model: str,
    get_raw: Callable[[int, str], tuple[dict, str, int, int, bool]],
    parse: Callable[[dict], dict],
    stage: str = "",
    label: str = "",
) -> AiCallResult:
    result, exc, truncated = _attempt(get_raw, parse, 0, primary_model)
    if result is not None:
        return result
    _log_failure(stage, label, primary_model, 0, exc, truncated)

    if isinstance(exc, AiProviderCallError):
        if not settings.AI_FAKE:
            time.sleep(_RETRY_BACKOFF_SECONDS)
        result, exc, truncated = _attempt(get_raw, parse, 1, primary_model)
        if result is not None:
            return result
        _log_failure(stage, label, primary_model, 1, exc, truncated)

    result, exc, truncated = _attempt(get_raw, parse, 2, fallback_model)
    if result is not None:
        result.used_fallback = True
        return result
    _log_failure(stage, label, fallback_model, 2, exc, truncated)

    if isinstance(exc, AiProviderCallError):
        raise exc
    raise AiSchemaError("The model's response did not match the expected shape.") from exc
