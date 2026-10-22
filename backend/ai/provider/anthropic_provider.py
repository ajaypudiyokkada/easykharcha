"""The real provider — used whenever AI_FAKE is false. Forces a tool call so the model's answer is
always shaped JSON (never free text to scrape), caches the static system prompt, and gives the SDK's
own retry (network/5xx/429) plus a 60s request timeout."""

import anthropic
from django.conf import settings

from .. import prompts
from ..schemas import MenuExtractionResult, RecipeSuggestionsResult
from .base import AiCallResult, run_with_fallback
from .errors import AiProviderCallError

_REQUEST_TIMEOUT_SECONDS = 60.0
_MAX_TOKENS_MENU = 8000
_MAX_TOKENS_RECIPE = 4000


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=_REQUEST_TIMEOUT_SECONDS)


def _tool_input(response, tool_name: str) -> dict:
    for block in response.content:
        if block.type == "tool_use" and block.name == tool_name:
            return block.input
    # No tool call at all (e.g. the model refused) — an empty dict fails schema validation the same
    # way a malformed one would, so this falls through to the fallback-model retry naturally.
    return {}


def _get_raw(
    *, model: str, system: str, messages: list[dict], tool: dict, max_tokens: int
) -> tuple[dict, str, int, int]:
    try:
        response = _client().messages.create(
            model=model,
            max_tokens=max_tokens,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            tools=[tool],
            tool_choice={"type": "tool", "name": tool["name"]},
            messages=messages,
        )
    except anthropic.APIError as exc:
        raise AiProviderCallError(str(exc)) from exc

    raw = _tool_input(response, tool["name"])
    return raw, model, response.usage.input_tokens, response.usage.output_tokens


def extract_menu(files: list[dict], business_type: str) -> AiCallResult:
    messages = prompts.menu_messages(files, business_type)
    tool = prompts.menu_tool()

    return run_with_fallback(
        primary_model=settings.AI_MODEL_MENU,
        fallback_model=settings.AI_MODEL_FALLBACK,
        get_raw=lambda _attempt, model: _get_raw(
            model=model,
            system=prompts.MENU_SYSTEM_PROMPT,
            messages=messages,
            tool=tool,
            max_tokens=_MAX_TOKENS_MENU,
        ),
        parse=lambda raw: MenuExtractionResult.model_validate(raw).sanitized(),
    )


def suggest_recipes(
    dish_names: list[str], business_type: str, stock_item_names: list[str]
) -> AiCallResult:
    messages = prompts.recipe_messages(dish_names, business_type, stock_item_names)
    tool = prompts.recipe_tool()

    return run_with_fallback(
        primary_model=settings.AI_MODEL_RECIPE,
        fallback_model=settings.AI_MODEL_FALLBACK,
        get_raw=lambda _attempt, model: _get_raw(
            model=model,
            system=prompts.RECIPE_SYSTEM_PROMPT,
            messages=messages,
            tool=tool,
            max_tokens=_MAX_TOKENS_RECIPE,
        ),
        parse=lambda raw: RecipeSuggestionsResult.model_validate(raw).model_dump(),
    )
