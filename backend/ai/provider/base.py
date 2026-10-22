"""Shared by both providers: the parse-validate-fallback contract described in Step C1's spec. A
provider only has to supply get_raw (how to get one attempt's raw tool input) and parse (how to
validate and sanitise it) — the retry-once-on-the-fallback-model logic lives here exactly once."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .errors import AiSchemaError


@dataclass
class AiCallResult:
    data: dict
    model: str
    input_tokens: int
    output_tokens: int
    used_fallback: bool = False


def run_with_fallback(
    *,
    primary_model: str,
    fallback_model: str,
    get_raw: Callable[[int, str], tuple[dict, str, int, int]],
    parse: Callable[[dict], dict],
) -> AiCallResult:
    raw, model, input_tokens, output_tokens = get_raw(0, primary_model)
    try:
        return AiCallResult(
            data=parse(raw), model=model, input_tokens=input_tokens, output_tokens=output_tokens
        )
    except Exception:
        pass

    raw, model, input_tokens, output_tokens = get_raw(1, fallback_model)
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
    )
