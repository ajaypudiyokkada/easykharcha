"""Step EK-1/EK-2: given a menu's dishes, the business sector and the owner's existing stock items,
suggests which kitchen BASES (1,000 g/ml batches of raw ingredients) this menu needs and which
dishes use each one. EK-2 replaced the original free-form "ask the model for the whole mapping"
design: the model now only classifies each dish into a fixed type (classification.py), and
map_bases_from_classification looks up the base + grams/ml per portion deterministically from
knowledge/<sector>.json's type_rules — the model never invents a base, a formula, or a quantity.
Deterministic sanity checks still run on the result afterward. Backend only — no screen or confirm
flow yet, see docs/BASES_PLAN.md for the Base/BaseIngredient/SellItemBase models this eventually
feeds."""

import hashlib
import re

from . import limits
from .classification import classify_dishes
from .exceptions import AiDailyLimitReached, AiUnavailable
from .knowledge import load_library
from .matching import normalise
from .models import AiKitchenBaseCache, AiUsageKind

# Bumped whenever map_bases_from_classification's logic or a sector's type_rules changes meaningfully
# — part of the per-menu cache key, same role as prompts.py's *_PROMPT_VERSION constants.
MAPPING_VERSION = 1

_OVERFILL_TOLERANCE = 0.15
_MAX_PORTION_GRAMS = 600

# Strips a trailing "(...)" decoration off a heading, e.g. "Chicken Wings (Hot Garlic / BBQ /
# Crispy)" -> "Chicken Wings" — expand_dish_options combines THIS bare phrase with each variant,
# never the raw name-with-parentheses (which would otherwise be glued onto every expanded dish).
_TRAILING_PAREN = re.compile(r"\s*\([^()]*\)\s*$")


def expand_dish_options(dishes: list[dict]) -> list[dict]:
    """Turns one menu row carrying 2+ `variants` (schemas.ExtractedDish — set for both an inline
    "Chicken (Manchurian/Chilli)" line and a heading-plus-separate-choices group like a "MANCHURIAN"
    heading over "Gobi/Paneer/Babycorn/Mushroom") into one real dish per variant, combined according
    to `variant_position` ("prefix": heading + variant, the common case; "suffix": variant +
    heading). `variant_prices`, when present, gives each expanded dish its own price instead of the
    row's single price. Deterministic, no model call. Each expanded row carries `expanded_from` (the
    original heading text) so a future review screen can flag it. A dish with fewer than 2 variants
    passes through unchanged — it is never left in the output named only by its bare heading."""
    expanded = []
    for dish in dishes:
        variants = [v for v in (dish.get("variants") or []) if v]
        if len(variants) < 2:
            expanded.append(dish)
            continue
        heading = _TRAILING_PAREN.sub("", dish.get("name", "")).strip() or dish.get("name", "")
        position = dish.get("variant_position") or "prefix"
        variant_prices = dish.get("variant_prices")
        for index, option in enumerate(variants):
            name = f"{heading} {option}" if position == "prefix" else f"{option} {heading}"
            row = {**dish, "name": name, "expanded_from": dish.get("name", "")}
            if variant_prices and index < len(variant_prices):
                row["price"] = variant_prices[index]
            expanded.append(row)
    return expanded


def apply_groups(dishes: list[dict], groups: list[dict]) -> list[dict]:
    """Step EK-2b: runs AFTER expand_dish_options, using the dedicated group pass's output
    (extraction.MenuExtractionOutcome.groups) as a safety net for a designed, multi-column menu
    where the combined single pass still left a bare heading dish standing alone (e.g. just
    "Manchurian", with no variants of its own) instead of attaching its choices to it. For every
    discovered group: drops any dish in the list whose name matches the group's heading with no
    variants (the broken leftover), then adds the group's real combined dishes (built the same way
    expand_dish_options builds them) unless a clean first-pass expansion already produced them.
    Deterministic, no model call. A menu with no groups passes through unchanged."""
    if not groups:
        return dishes

    group_heading_norms = {normalise(g["heading"]) for g in groups}
    kept = [
        dish
        for dish in dishes
        if not (
            normalise(dish["name"]) in group_heading_norms and len(dish.get("variants") or []) < 2
        )
    ]
    existing_names = {normalise(dish["name"]) for dish in kept}

    as_dish_rows = [
        {
            "name": group["heading"],
            "price": group.get("price"),
            "confidence": 0.8,
            "variants": group.get("choices", []),
            "variant_position": group.get("position", "prefix"),
            "variant_prices": group.get("prices"),
        }
        for group in groups
    ]
    for row in expand_dish_options(as_dish_rows):
        key = normalise(row["name"])
        if key in existing_names:
            continue
        existing_names.add(key)
        kept.append(row)
    return kept


def _cache_key(dish_names: list[str]) -> str:
    normalised = sorted({normalise(name) for name in dish_names})
    return hashlib.sha256("|".join(normalised).encode("utf-8")).hexdigest()


def map_bases_from_classification(
    dishes: list[dict], classifications: dict[str, dict], library: dict
) -> list[dict]:
    """The deterministic replacement for the old model-driven mapping (EK-1): for every dish, look
    its classified type up in the sector's type_rules to find the one base it uses and how many
    grams/ml per portion (a family_overrides entry, e.g. "mutton": 220, wins over the type's own
    default). Never asks the model to invent a base, a formula, or a quantity — only which type a
    dish is. A type with no rule (null in type_rules, or missing) contributes no base."""
    type_rules = library.get("type_rules", {})
    templates_by_name = {t["name"]: t for t in library.get("base_templates", [])}
    excluded = set(library.get("rules", {}).get("excluded_by_default", []))

    groups: dict[str, list[dict]] = {}
    for dish in dishes:
        name = dish["name"]
        info = classifications.get(normalise(name), {"type": "other", "family": ""})
        rule = type_rules.get(info["type"])
        if not rule:
            continue
        base_name = rule["base"]
        if base_name in excluded or base_name not in templates_by_name:
            continue
        family = (info.get("family") or "").lower()
        grams = rule.get("family_overrides", {}).get(family, rule["grams_per_portion"])
        groups.setdefault(base_name, []).append(
            {"dish": name, "grams_per_portion": grams, "family": family or info["type"]}
        )

    bases = []
    for base_name, used_by in groups.items():
        template = templates_by_name[base_name]
        bases.append(
            {
                "name": template["name"],
                "type": template.get("type", ""),
                "batch_ingredients": [
                    {"name": i["name"], "qty": i["qty"], "unit": i["unit"]}
                    for i in template["formula"]
                ],
                "yield_qty": template.get("batch_yield_qty", 1000),
                "used_by": used_by,
                "confidence": 0.9,
                "source": "library",
                "reason": f"used by {len(used_by)} dishes (rule-based mapping)",
                "flags": [],
            }
        )
    return bases


def sanity_check(bases: list[dict], dishes: list[dict], rules: dict) -> list[dict]:
    """Runs AFTER map_bases_from_classification. Drops a base used by fewer dishes than the sector's
    rule (not a real shared base on this menu) and flags (never drops) a formula whose listed
    ingredients add up to MORE than the batch's own yield — physically impossible, since water (not
    a stock item, see knowledge/restaurant_cafe.json's template notes) makes up the rest of the
    batch, so under-filling is normal and expected, not an error. Also flags an implausibly high
    per-portion amount. Flags travel with the result; nothing here invents or corrects a number."""
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
        if total > yield_qty * (1 + _OVERFILL_TOLERANCE):
            flags.append(f"formula sums to {total:.0f}, more than its {yield_qty:.0f} yield")
        for use in used_by:
            if use["grams_per_portion"] > _MAX_PORTION_GRAMS:
                flags.append(
                    f"{use['dish']}: {use['grams_per_portion']:.0f} g/ml per portion looks too high"
                )

        kept.append({**base, "used_by": used_by, "flags": flags})

    return kept


def discover_bases(
    dishes: list[dict],
    sector: str,
    stock_item_names: list[str],
    business=None,
    *,
    classify_fn=None,
) -> dict:
    """dishes: [{"name": ..., ...}], already run through expand_dish_options. Classifies every dish
    (classification.classify_dishes, cached per dish name), then maps bases deterministically from
    the sector's type_rules (map_bases_from_classification) and runs sanity_check. Returns
    {"bases": [...], "usage": [...] } — usage is a list of per-classification-batch call info, empty
    when every dish's type was already cached. `business` is optional (the manual try script has
    none): when given, this enforces and counts against the same AiUsage/daily-cap/monthly-cap
    machinery as menu scans and recipe suggestions. `classify_fn` defaults to provider.classify_dishes
    (AI_FAKE-aware dispatch); scripts/ai_try_kitchen.py passes anthropic_provider.classify_dishes
    directly to always hit the real API, same extract_fn pattern as the other two AI pipelines."""
    library = load_library(sector)
    dish_names = [d["name"] for d in dishes]
    cache_key = _cache_key(dish_names)

    cached = AiKitchenBaseCache.objects.filter(
        sector=sector, dish_set_hash=cache_key, prompt_version=MAPPING_VERSION
    ).first()
    if cached:
        return {"bases": cached.result["bases"], "usage": []}

    if business is not None:
        if limits.monthly_cost_cap_exceeded():
            raise AiUnavailable()
        if not limits.check_daily_kitchen_limit(business.id, len(dish_names)):
            raise AiDailyLimitReached()

    classifications, usage = classify_dishes(dishes, sector, classify_fn=classify_fn)
    bases = map_bases_from_classification(dishes, classifications, library)
    bases = sanity_check(bases, dishes, library["rules"])

    if business is not None:
        for call in usage:
            limits.record_usage(
                business=business,
                kind=AiUsageKind.KITCHEN_BASE_DISCOVERY,
                model=call["model"],
                input_tokens=call["input_tokens"],
                output_tokens=call["output_tokens"],
            )

    AiKitchenBaseCache.objects.update_or_create(
        sector=sector,
        dish_set_hash=cache_key,
        prompt_version=MAPPING_VERSION,
        defaults={"result": {"bases": bases}},
    )
    return {"bases": bases, "usage": usage}
