"""The real provider — used whenever AI_FAKE is false. Forces a tool call so the model's answer is
always shaped JSON (never free text to scrape), caches the static system prompt, and gives the SDK's
own retry (network/5xx/429) plus a 60s request timeout."""

import anthropic
from django.conf import settings

from .. import prompts
from ..schemas import (
    BestSellersResult,
    DishClassificationResult,
    FamilyRecipeSuggestion,
    GroupExtractionResult,
    IngredientMergeResult,
    MenuExtractionResult,
    RecipeSuggestionsResult,
)
from .base import AiCallResult, run_with_fallback
from .errors import AiProviderCallError

_REQUEST_TIMEOUT_SECONDS = 60.0
_MAX_TOKENS_MENU = 8000
_MAX_TOKENS_RECIPE = 4000
# A batch of ~60-80 dishes each needing a type/family/confidence echoed back needs real room.
_MAX_TOKENS_KITCHEN = 8000
_MAX_TOKENS_BEST_SELLER = 2000
_MAX_TOKENS_FAMILY_RECIPE = 2000
# A real menu's full ingredient list can be ~100 distinct names, and the model must echo every one
# back inside some group — real-run testing found 3000 silently truncated to 0 groups (the schema's
# safe empty-list default masked the truncation as "nothing to merge" instead of failing loudly).
_MAX_TOKENS_MERGE = 8000

# Models that default to adaptive extended thinking reject a forced tool_choice ("tool" or "any") —
# the API returns a 400 ("tool_choice: type ... are not supported for this model"), since forcing an
# immediate tool call is incompatible with the model reasoning first. For those, fall back to
# tool_choice "auto" plus an explicit system instruction to only answer via the tool, and verify the
# response actually contains a tool_use block (retrying once if it doesn't) since "auto" alone doesn't
# guarantee one. Every other model keeps the simpler forced tool_choice. Update this set if a new
# AI_MODEL_* value starts rejecting forced tool_choice too.
_MODELS_REQUIRING_AUTO_TOOL_CHOICE = {"claude-sonnet-5-5"}


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=_REQUEST_TIMEOUT_SECONDS)


def _tool_input(response, tool_name: str) -> dict:
    for block in response.content:
        if block.type == "tool_use" and block.name == tool_name:
            return block.input
    # No tool call at all (e.g. the model refused) — an empty dict fails schema validation the same
    # way a malformed one would, so this falls through to the fallback-model retry naturally.
    return {}


def tool_choice_for_model(model: str, system: str, tool_name: str) -> tuple[dict, str, bool]:
    """Pure (no network) so scripts/smoke.py's check_ai_provider_signature can assert a given model
    never gets a forced tool_choice, without an API key or a real call. Returns (tool_choice,
    system_text, needs_auto)."""
    if model in _MODELS_REQUIRING_AUTO_TOOL_CHOICE:
        system_text = f"{system} You must answer only by calling the {tool_name} tool — never with plain text."
        return {"type": "auto"}, system_text, True
    return {"type": "tool", "name": tool_name}, system, False


def _get_raw(
    *, model: str, system: str, messages: list[dict], tool: dict, max_tokens: int
) -> tuple[dict, str, int, int, bool]:
    tool_choice, system_text, needs_auto = tool_choice_for_model(model, system, tool["name"])

    input_tokens = output_tokens = 0
    raw: dict = {}
    truncated = False
    for _attempt in range(2 if needs_auto else 1):
        try:
            response = _client().messages.create(
                model=model,
                max_tokens=max_tokens,
                system=[
                    {"type": "text", "text": system_text, "cache_control": {"type": "ephemeral"}}
                ],
                tools=[tool],
                tool_choice=tool_choice,
                messages=messages,
            )
        except anthropic.APIError as exc:
            raise AiProviderCallError(
                str(exc), status_code=getattr(exc, "status_code", None), exc_type=type(exc).__name__
            ) from exc

        input_tokens += response.usage.input_tokens
        output_tokens += response.usage.output_tokens
        raw = _tool_input(response, tool["name"])
        truncated = response.stop_reason == "max_tokens"
        if raw or not needs_auto:
            break

    return raw, model, input_tokens, output_tokens, truncated


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
        stage="menu_extraction",
    )


def extract_menu_groups(files: list[dict], business_type: str) -> AiCallResult:
    messages = prompts.menu_messages(files, business_type)
    tool = prompts.group_tool()

    return run_with_fallback(
        primary_model=settings.AI_MODEL_MENU,
        fallback_model=settings.AI_MODEL_FALLBACK,
        get_raw=lambda _attempt, model: _get_raw(
            model=model,
            system=prompts.GROUP_SYSTEM_PROMPT,
            messages=messages,
            tool=tool,
            max_tokens=_MAX_TOKENS_MENU,
        ),
        parse=lambda raw: GroupExtractionResult.model_validate(raw).sanitized(),
        stage="menu_group_extraction",
    )


def suggest_recipes(
    dish_names: list[str], business_type: str, stock_items: list[tuple[str, str]]
) -> AiCallResult:
    messages = prompts.recipe_messages(dish_names, business_type, stock_items)
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
        stage="recipe_suggestion",
    )


def classify_dishes(dish_names: list[str], sector: str, dish_types: list[str]) -> AiCallResult:
    messages = prompts.classify_messages(dish_names, sector, dish_types)
    tool = prompts.classify_tool(dish_types)

    return run_with_fallback(
        primary_model=settings.AI_MODEL_KITCHEN,
        fallback_model=settings.AI_MODEL_FALLBACK,
        get_raw=lambda _attempt, model: _get_raw(
            model=model,
            system=prompts.CLASSIFY_SYSTEM_PROMPT,
            messages=messages,
            tool=tool,
            max_tokens=_MAX_TOKENS_KITCHEN,
        ),
        parse=lambda raw: DishClassificationResult.model_validate(raw).model_dump(),
        stage="classify_dishes",
    )


def pick_best_sellers(shortlist: list[dict], business_type: str) -> AiCallResult:
    messages = prompts.best_seller_messages(shortlist, business_type)
    tool = prompts.best_seller_tool()

    return run_with_fallback(
        primary_model=settings.AI_MODEL_KITCHEN,
        fallback_model=settings.AI_MODEL_FALLBACK,
        get_raw=lambda _attempt, model: _get_raw(
            model=model,
            system=prompts.BEST_SELLER_SYSTEM_PROMPT,
            messages=messages,
            tool=tool,
            max_tokens=_MAX_TOKENS_BEST_SELLER,
        ),
        parse=lambda raw: BestSellersResult.model_validate(raw).model_dump(),
        stage="best_sellers",
    )


def compose_family_recipe(
    family_name: str,
    member_dish_names: list[str],
    business_type: str,
    stock_items: list[tuple[str, str]],
    excluded_ingredient_names: list[str],
) -> AiCallResult:
    messages = prompts.family_recipe_messages(
        family_name, member_dish_names, business_type, stock_items, excluded_ingredient_names
    )
    tool = prompts.family_recipe_tool()

    return run_with_fallback(
        primary_model=settings.AI_MODEL_RECIPE,
        fallback_model=settings.AI_MODEL_FALLBACK,
        get_raw=lambda _attempt, model: _get_raw(
            model=model,
            system=prompts.FAMILY_RECIPE_SYSTEM_PROMPT,
            messages=messages,
            tool=tool,
            max_tokens=_MAX_TOKENS_FAMILY_RECIPE,
        ),
        parse=lambda raw: FamilyRecipeSuggestion.model_validate(raw).model_dump(),
        stage="family_recipe",
        label=family_name,
    )


def merge_ingredients(items: list[dict]) -> AiCallResult:
    messages = prompts.merge_messages(items)
    tool = prompts.merge_tool()

    return run_with_fallback(
        primary_model=settings.AI_MODEL_KITCHEN,
        fallback_model=settings.AI_MODEL_FALLBACK,
        get_raw=lambda _attempt, model: _get_raw(
            model=model,
            system=prompts.MERGE_SYSTEM_PROMPT,
            messages=messages,
            tool=tool,
            max_tokens=_MAX_TOKENS_MERGE,
        ),
        parse=lambda raw: IngredientMergeResult.model_validate(raw).model_dump(),
        stage="merge_ingredients",
    )
