"""Shared by both providers: the parse-validate-fallback contract described in Step C1's spec. A
provider only has to supply get_raw (how to get one attempt's raw tool input) and parse (how to
validate and sanitise it) — the retry-once-on-the-fallback-model logic lives here exactly once."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .errors import AiSchemaError

logger = logging.getLogger(__name__)


@dataclass
class AiCallResult:
    data: dict
    model: str
    input_tokens: int
    output_tokens: int
    used_fallback: bool = False
    truncated: bool = False


def run_with_fallback(
    *,
    primary_model: str,
    fallback_model: str,
    get_raw: Callable[[int, str], tuple[dict, str, int, int, bool]],
    parse: Callable[[dict], dict],
) -> AiCallResult:
    raw, model, input_tokens, output_tokens, truncated = get_raw(0, primary_model)
    try:
        return AiCallResult(
            data=parse(raw),
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            truncated=truncated,
        )
    except Exception as exc:
        # Never log raw — it's the model's raw menu/recipe output. Falling back to fallback_model.
        logger.warning(
            "AI primary model %s output failed validation (%s), falling back to %s: %s",
            primary_model,
            type(exc).__name__,
            fallback_model,
            exc,
        )

    raw, model, input_tokens, output_tokens, truncated = get_raw(1, fallback_model)
    try:
        data: dict[str, Any] = parse(raw)
    except Exception as exc:
        raise AiSchemaError("The model's response did not match the expected shape.") from exc
    return AiCallResult(
        data=data,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        used_fallback=True,
        truncated=truncated,
    )
