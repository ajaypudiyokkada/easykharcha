"""Step EK-1: given a menu's dishes, the business sector and the owner's existing stock items,
suggests which kitchen BASES (1,000 g/ml batches of raw ingredients) this menu needs and which
dishes use each one. Library-first (knowledge/<sector>.json) with the model filling gaps and
adjusting quantities; deterministic sanity checks run on the model's result afterward, same
"never trust model output outright" rule as schemas.py. Backend only — no screen or confirm flow
yet, see docs/BASES_PLAN.md for the Base/BaseIngredient/SellItemBase models this eventually feeds."""

import hashlib
import re

from . import limits, provider
from .exceptions import AiDailyLimitReached, AiUnavailable
from .knowledge import load_library
from .matching import normalise
from .models import AiKitchenBaseCache, AiUsageKind
from .prompts import BASE_DISCOVERY_PROMPT_VERSION

_FORMULA_TOLERANCE = 0.15
_MAX_PORTION_GRAMS = 600
_MAX_BASES_PER_DISH = 2

# "Chicken (Manchurian/Chilli/Pepper/Lemon)" -> base name "Chicken", options ["Manchurian", ...].
_OPTION_PATTERN = re.compile(r"^(.*?)\s*\(([^()]+)\)\s*$")


def expand_dish_options(dishes: list[dict]) -> list[dict]:
    """A menu line with variants written inline, e.g. "Chicken (Manchurian/Chilli/Pepper/Lemon)",
    becomes one separate dish per option at the same price — deterministic, no model call. Each
    expanded row carries `expanded_from` (the original line text) so the owner's review screen (a
    later step) can flag it. A dish with no parenthesised option group passes through unchanged."""
    expanded = []
    for dish in dishes:
        name = dish.get("name", "")
        match = _OPTION_PATTERN.match(name)
        options = [opt.strip() for opt in match.group(2).split("/")] if match else []
        if match and len(options) >= 2 and all(options):
            base_name = match.group(1).strip()
            for option in options:
                expanded.append({**dish, "name": f"{base_name} {option}", "expanded_from": name})
        else:
            expanded.append(dish)
    return expanded


def _cache_key(dish_names: list[str]) -> str:
    normalised = sorted({normalise(name) for name in dish_names})
    return hashlib.sha256("|".join(normalised).encode("utf-8")).hexdigest()


def sanity_check(bases: list[dict], dishes: list[dict], rules: dict) -> list[dict]:
    """Runs AFTER schema validation, on the model's own output. Drops a base used by fewer dishes
    than the sector's rule (not a real shared base on this menu), flags (never drops) a formula that
    doesn't sum close to its own yield, a per-portion amount that looks implausibly high, or a dish
    pulled into more bases than usual (likely over-fitting). Flags travel with the result; nothing
    here invents or corrects a number, only drops/flags."""
    min_dishes = rules.get("min_dishes_to_suggest_base", 3)
    min_grams = rules.get("min_grams_per_portion", 30)
    dish_names_norm = {normalise(d["name"]) for d in dishes}

    kept = []
    for base in bases:
        used_by = [u for u in base["used_by"] if normalise(u["dish"]) in dish_names_norm]
        used_by = [u for u in used_by if u["grams_per_portion"] >= min_grams]
        if len(used_by) < min_dishes:
            continue  # dropped silently — not a real, shared base on this menu

        flags = list(base.get("flags", []))
        total = sum(ing["qty"] for ing in base["batch_ingredients"])
        yield_qty = base.get("yield_qty") or 1000
        if abs(total - yield_qty) / yield_qty > _FORMULA_TOLERANCE:
            flags.append(f"formula sums to {total:.0f}, not ~{yield_qty:.0f}")
        for use in used_by:
            if use["grams_per_portion"] > _MAX_PORTION_GRAMS:
                flags.append(
                    f"{use['dish']}: {use['grams_per_portion']:.0f} g/ml per portion looks too high"
                )

        kept.append({**base, "used_by": used_by, "flags": flags})

    dish_base_count: dict[str, int] = {}
    for base in kept:
        for use in base["used_by"]:
            key = normalise(use["dish"])
            dish_base_count[key] = dish_base_count.get(key, 0) + 1
    for base in kept:
        for use in base["used_by"]:
            if dish_base_count[normalise(use["dish"])] > _MAX_BASES_PER_DISH:
                note = f"{use['dish']} maps to more than {_MAX_BASES_PER_DISH} bases — check it fits this one"
                if note not in base["flags"]:
                    base["flags"].append(note)

    return kept


def discover_bases(
    dishes: list[dict],
    sector: str,
    stock_item_names: list[str],
    business=None,
    *,
    discover_fn=None,
) -> dict:
    """dishes: [{"name": ..., ...}], already run through expand_dish_options. Returns
    {"bases": [...], "usage": {...} | None} — usage is None on a cache hit (no model call made).
    `business` is optional (the manual try script has none): when given, this enforces and counts
    against the same AiUsage/daily-cap/monthly-cap machinery as menu scans and recipe suggestions —
    a future endpoint (EK-2/EK-3) calls this the same way RecipeSuggestionView calls suggest_recipes.
    `discover_fn` defaults to provider.discover_bases (AI_FAKE-aware dispatch); scripts/
    ai_try_kitchen.py passes anthropic_provider.discover_bases directly to always hit the real API
    regardless of AI_FAKE, same pattern as extraction.run_menu_extraction's extract_fn."""
    discover = discover_fn or provider.discover_bases
    library = load_library(sector)
    dish_names = [d["name"] for d in dishes]
    cache_key = _cache_key(dish_names)

    cached = AiKitchenBaseCache.objects.filter(
        sector=sector, dish_set_hash=cache_key, prompt_version=BASE_DISCOVERY_PROMPT_VERSION
    ).first()
    if cached:
        return {"bases": cached.result["bases"], "usage": None}

    if business is not None:
        if limits.monthly_cost_cap_exceeded():
            raise AiUnavailable()
        if not limits.check_daily_kitchen_limit(business.id, len(dish_names)):
            raise AiDailyLimitReached()

    result = discover(dishes, sector, stock_item_names, library)
    bases = sanity_check(result.data["bases"], dishes, library["rules"])

    if business is not None:
        limits.record_usage(
            business=business,
            kind=AiUsageKind.KITCHEN_BASE_DISCOVERY,
            model=result.model,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
        )

    AiKitchenBaseCache.objects.update_or_create(
        sector=sector,
        dish_set_hash=cache_key,
        prompt_version=BASE_DISCOVERY_PROMPT_VERSION,
        defaults={"result": {"bases": bases}},
    )
    return {
        "bases": bases,
        "usage": {
            "model": result.model,
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "used_fallback": result.used_fallback,
            # True when the model's own output hit max_tokens — an empty or short bases list in
            # this case may be missing real bases rather than correctly finding none; unlike menu
            # scans there's no "incomplete" flag on a stored result yet (no model/table for one),
            # so the caller (the try script today, a future endpoint later) decides what to do.
            "truncated": result.truncated,
        },
    }
