"""Step EK-3: after the menu is read and bases are found (base_discovery.discover_bases), this
proposes (1) which dishes to set up first, (2) one recipe per dish FAMILY (dishes that share a
recipe shape, e.g. "all Manchurian-style starters"), and (3) the ingredient list those recipes and
bases need, matched to the owner's existing stock items or proposed as new. Backend only — nothing
here writes to StockItem/SellItem/Recipe, see suggest_setup's docstring. All AI output passes through
schemas.py validation and this module's own sanity rules before being trusted; nothing is invented
that wasn't in the dish list or a sector's own knowledge library."""

import hashlib
from decimal import Decimal

from django.conf import settings

from . import limits
from .base_discovery import discover_bases
from .classification import classify_dishes
from .exceptions import AiDailyLimitReached, AiUnavailable
from .knowledge import load_library
from .matching import match_stock_item, normalise, stock_items_by_normalised_name, unit_family
from .models import AiFamilyRecipeCache, AiUsageKind
from .prompts import FAMILY_RECIPE_PROMPT_VERSION
from .provider import compose_family_recipe as provider_compose_family_recipe
from .provider import pick_best_sellers as provider_pick_best_sellers

MAX_FAMILIES_PER_MENU = 25
MIN_BEST_SELLERS = 8
MAX_BEST_SELLERS = 12
MIN_BEST_SELLER_CATEGORIES = 4

# A dish's classify_dishes `type` (ai/knowledge/dish_types.json) rolled up into the coarser grouping
# the best-seller picker and the family composer both show the owner — every type not listed here
# (or an empty/unknown one) falls back to "other".
_CATEGORY_BY_TYPE = {
    "fried_starter_tossed": "starter",
    "fried_starter_dry": "starter",
    "plain_fried_snack": "starter",
    "dry_masala_fry": "starter",
    "grilled_tandoori": "starter",
    "veg_starter_snack": "starter",
    "soup": "starter",
    "salad": "starter",
    "gravy_nonveg": "main",
    "gravy_veg": "main",
    "gravy_makhani": "main",
    "gravy_chinese": "main",
    "gravy_thai": "main",
    "butter_garlic": "main",
    "dal": "main",
    "rice_plain": "rice_bread",
    "rice_fried": "rice_bread",
    "noodles": "rice_bread",
    "bread_dough": "rice_bread",
    "bread_maida": "rice_bread",
    "beverage": "drink",
    "dessert": "dessert",
}

_MIN_QTY_BY_UNIT = {"g": 5.0, "ml": 5.0, "pieces": 1.0}
_MAX_QTY_BY_UNIT = {"g": 600.0, "ml": 600.0, "pieces": 20.0}
_DEFAULT_QTY_BY_UNIT = {"g": 150.0, "ml": 150.0, "pieces": 1.0}

# Prep-descriptor words stripped before merging two ingredient names as "the same thing" (Onion vs
# Onion Chopped) — never strips a word that changes what the ingredient actually is.
_DESCRIPTOR_WORDS = {
    "chopped",
    "sliced",
    "diced",
    "minced",
    "crushed",
    "grated",
    "julienned",
    "cubed",
    "fresh",
    "whole",
    "ground",
    "paste",
}

_PERISHABLE_KEYWORDS = {
    "milk",
    "cream",
    "paneer",
    "curd",
    "yogurt",
    "fish",
    "prawn",
    "chicken",
    "mutton",
    "egg",
    "butter",
    "onion",
    "tomato",
    "coriander",
    "mint",
    "lettuce",
    "cabbage",
    "capsicum",
    "gobi",
    "mushroom",
    "potato",
    "lemon",
    "curry leaves",
    "spinach",
}
_DRY_STAPLE_KEYWORDS = {
    "rice",
    "atta",
    "maida",
    "cornflour",
    "sugar",
    "salt",
    "oil",
    "vinegar",
    "sauce",
    "spice",
    "masala",
    "flour",
    "lentil",
    "dal",
    "besan",
    "sooji",
}
_PACKAGING_KEYWORDS = {"box", "bag", "napkin", "foil", "container", "cleaning", "tissue", "wrap"}


def category_for_type(dish_type: str) -> str:
    return _CATEGORY_BY_TYPE.get(dish_type, "other")


def _keyword_score(name_norm: str, keywords: list[str]) -> int:
    return sum(1 for kw in keywords if kw in name_norm)


def _shortlist(dishes: list[dict], classifications: dict[str, dict], library: dict) -> list[dict]:
    """Library-keyword-ranked candidates, grouped by category, used to build the one small AI call's
    input — never the whole menu, to keep that call cheap."""
    keywords = library.get("popular_keywords", [])
    by_category: dict[str, list[tuple[int, dict]]] = {}
    for dish in dishes:
        info = classifications.get(normalise(dish["name"]), {})
        category = category_for_type(info.get("type", ""))
        score = _keyword_score(normalise(dish["name"]), keywords) * 10 + int(
            info.get("confidence", 0) * 10
        )
        by_category.setdefault(category, []).append((score, dish))

    shortlist = []
    for category, scored in by_category.items():
        scored.sort(key=lambda pair: -pair[0])
        for _score, dish in scored[:8]:
            shortlist.append({"name": dish["name"], "category": category})
    return shortlist


def pick_best_sellers(
    dishes: list[dict],
    classifications: dict[str, dict],
    sector: str,
    business=None,
    *,
    pick_fn=None,
) -> dict:
    """Returns {"best_sellers": [{"name", "category", "reason"}], "usage": [...]}. Library-keyword
    scoring builds the shortlist, one AI call narrows it down; any pick the model returns that isn't
    an exact (normalised) match to a real dish in the shortlist is dropped (F: never invent a dish).
    If the survivors don't reach MIN_BEST_SELLERS or MIN_BEST_SELLER_CATEGORIES, the gap is filled
    deterministically from the same ranked shortlist, round-robin by category."""
    library = load_library(sector)
    shortlist = _shortlist(dishes, classifications, library)
    shortlist_by_norm = {normalise(item["name"]): item for item in shortlist}
    usage: list[dict] = []
    picks: list[dict] = []
    seen: set[str] = set()

    can_call_ai = bool(shortlist) and (business is None or not limits.monthly_cost_cap_exceeded())
    if can_call_ai:
        pick = pick_fn or provider_pick_best_sellers
        result = pick(shortlist, sector)
        usage.append(
            {
                "model": result.model,
                "input_tokens": result.input_tokens,
                "output_tokens": result.output_tokens,
                "used_fallback": result.used_fallback,
            }
        )
        if business is not None:
            limits.record_usage(
                business=business,
                kind=AiUsageKind.SETUP_BEST_SELLERS,
                model=result.model,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
            )
        for raw_pick in result.data["picks"]:
            key = normalise(raw_pick["name"])
            if key not in shortlist_by_norm or key in seen:
                continue
            seen.add(key)
            picks.append(
                {
                    "name": shortlist_by_norm[key]["name"],
                    "category": shortlist_by_norm[key]["category"],
                    "reason": raw_pick.get("reason", ""),
                }
            )

    categories_covered = {p["category"] for p in picks}
    if len(picks) < MIN_BEST_SELLERS or len(categories_covered) < MIN_BEST_SELLER_CATEGORIES:
        remaining_by_category: dict[str, list[dict]] = {}
        for item in shortlist:
            if normalise(item["name"]) in seen:
                continue
            remaining_by_category.setdefault(item["category"], []).append(item)
        while len(picks) < MAX_BEST_SELLERS and any(remaining_by_category.values()):
            for category in list(remaining_by_category):
                bucket = remaining_by_category[category]
                if not bucket:
                    del remaining_by_category[category]
                    continue
                item = bucket.pop(0)
                picks.append(
                    {
                        "name": item["name"],
                        "category": item["category"],
                        "reason": "a commonly popular dish",
                    }
                )
                seen.add(normalise(item["name"]))
                if len(picks) >= MAX_BEST_SELLERS:
                    break

    return {"best_sellers": picks[:MAX_BEST_SELLERS], "usage": usage}


def _family_key_for(dish: dict, classification: dict) -> tuple[str, str]:
    """(type, family-or-type) — grouping key for build_families. A dish with no family tag from
    classify_dishes groups by its type alone (e.g. every "rice_fried" dish is one family even with
    no specific style tag)."""
    dish_type = classification.get("type", "other")
    family_tag = classification.get("family") or dish_type
    return dish_type, family_tag


def _family_label(family_tag: str) -> str:
    return f"{family_tag.title()} family"


def build_families(dishes: list[dict], classifications: dict[str, dict]) -> list[dict]:
    """Groups dishes sharing a recipe shape (same classify_dishes family tag, or the same type when
    there's no tag) into families. Returns [{"name", "type", "dishes": [names]}], ordered by family
    size descending (largest families first — the ones most worth the owner's attention)."""
    groups: dict[tuple[str, str], list[str]] = {}
    for dish in dishes:
        info = classifications.get(normalise(dish["name"]), {"type": "other", "family": ""})
        key = _family_key_for(dish, info)
        groups.setdefault(key, []).append(dish["name"])

    families = [
        {"name": _family_label(family_tag), "type": dish_type, "dishes": names}
        for (dish_type, family_tag), names in groups.items()
    ]
    families.sort(key=lambda f: -len(f["dishes"]))
    return families


def _merge_small_families(families: list[dict], cap: int) -> list[dict]:
    """Over the cap: exhausts every possible same-`type` merge FIRST (so every merged "family" still
    shares one real recipe shape), one smallest-pair at a time across the whole list — not just
    relative to whichever family happens to be globally smallest, which could force a premature
    cross-type merge while an unrelated same-type pair elsewhere was still available. Only once no
    two remaining families share a type does it fall back to merging the smallest families overall,
    regardless of type, as a last resort to reach the cap."""
    families = [dict(f) for f in families]

    def _merge_smallest_pair(same_type_only: bool) -> bool:
        families.sort(key=lambda f: len(f["dishes"]))
        for smallest in families:
            match = next(
                (
                    f
                    for f in families
                    if f is not smallest and (not same_type_only or f["type"] == smallest["type"])
                ),
                None,
            )
            if match is not None:
                match["dishes"] = match["dishes"] + smallest["dishes"]
                families.remove(smallest)
                return True
        return False

    while len(families) > cap and _merge_smallest_pair(same_type_only=True):
        pass
    while len(families) > cap and _merge_smallest_pair(same_type_only=False):
        pass

    families.sort(key=lambda f: -len(f["dishes"]))
    return families


def _sanitise_qty(qty: float, unit: str) -> tuple[float, bool]:
    """Returns (qty, was_corrected). An implausible amount for its unit falls back to a flat
    default rather than trusting the model — F: never show a number outside sensible range."""
    low = _MIN_QTY_BY_UNIT.get(unit, 0.0)
    high = _MAX_QTY_BY_UNIT.get(unit, float("inf"))
    if low <= qty <= high:
        return qty, False
    return _DEFAULT_QTY_BY_UNIT.get(unit, qty), True


def _base_ingredient_names_for_family(family_dishes: list[str], bases: list[dict]) -> list[str]:
    """Every raw ingredient name already covered by a base used by any dish in this family — the
    family recipe call must not repeat these (F: recipes for dishes using a base must not repeat the
    base's own ingredients)."""
    family_dishes_norm = {normalise(name) for name in family_dishes}
    names: set[str] = set()
    for base in bases:
        used_by_this_family = any(
            normalise(use["dish"]) in family_dishes_norm for use in base["used_by"]
        )
        if used_by_this_family:
            names.update(ing["name"] for ing in base["batch_ingredients"])
    return sorted(names)


def _family_cache_key(sector: str, family_name: str, member_dish_names: list[str]) -> str:
    normalised = sorted({normalise(name) for name in member_dish_names})
    raw = normalise(family_name) + "|" + "|".join(normalised)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def compose_family_recipes(
    families: list[dict],
    bases: list[dict],
    business_type: str,
    stock_items: list[tuple[str, str]],
    business=None,
    *,
    compose_fn=None,
) -> dict:
    """One AI call per family (cached by (sector, family-members-hash) so a repeated family on a
    repeat run never pays twice), returning [{"name", "type", "dishes", "portion_label",
    "main_item": {...}, "member_overrides": [...], "bases_used": [...], "ingredients": [...],
    "minor_ingredients": [...], "corrections": [...]}]. Caps at MAX_FAMILIES_PER_MENU, merging the
    smallest families first. `bases` is base_discovery.discover_bases's own result — used only to
    look up each family's already-known base-grams-per-portion (deterministic, never asked of the
    model again) and which ingredient names to tell the model not to repeat."""
    capped = _merge_small_families(families, MAX_FAMILIES_PER_MENU)
    sector = business_type

    if business is not None and capped:
        if limits.monthly_cost_cap_exceeded():
            raise AiUnavailable()
        if not limits.check_daily_setup_limit(business.id, len(capped)):
            raise AiDailyLimitReached()

    compose = compose_fn or provider_compose_family_recipe
    results = []
    usage: list[dict] = []

    base_grams_by_dish_and_base: dict[str, list[dict]] = {}
    for base in bases:
        for use in base["used_by"]:
            base_grams_by_dish_and_base.setdefault(normalise(use["dish"]), []).append(
                {
                    "base": base["name"],
                    "grams_per_portion": use["grams_per_portion"],
                }
            )

    for family in capped:
        excluded = _base_ingredient_names_for_family(family["dishes"], bases)
        cache_key = _family_cache_key(sector, family["name"], family["dishes"])
        cached = AiFamilyRecipeCache.objects.filter(
            sector=sector, family_hash=cache_key, prompt_version=FAMILY_RECIPE_PROMPT_VERSION
        ).first()
        if cached:
            recipe = cached.result
        else:
            result = compose(family["name"], family["dishes"], business_type, stock_items, excluded)
            usage.append(
                {
                    "model": result.model,
                    "input_tokens": result.input_tokens,
                    "output_tokens": result.output_tokens,
                    "used_fallback": result.used_fallback,
                }
            )
            if business is not None:
                limits.record_usage(
                    business=business,
                    kind=AiUsageKind.SETUP_FAMILY_RECIPE,
                    model=result.model,
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                )
            recipe = result.data
            AiFamilyRecipeCache.objects.update_or_create(
                sector=sector,
                family_hash=cache_key,
                prompt_version=FAMILY_RECIPE_PROMPT_VERSION,
                defaults={"result": recipe},
            )

        corrections = []
        main_qty, corrected = _sanitise_qty(recipe["main_item_qty"], recipe["main_item_unit"])
        if corrected:
            corrections.append(
                f"{recipe['main_item_name']}: {recipe['main_item_qty']:g} {recipe['main_item_unit']} "
                f"per portion looked wrong, used the default {main_qty:g} instead"
            )

        member_overrides = []
        for member in recipe.get("member_quantities", []):
            if normalise(member["dish_name"]) not in {normalise(d) for d in family["dishes"]}:
                continue  # never trust a member name the family doesn't actually contain
            qty, member_corrected = _sanitise_qty(member["main_item_qty"], recipe["main_item_unit"])
            if member_corrected:
                corrections.append(
                    f"{member['dish_name']}: {member['main_item_qty']:g} {recipe['main_item_unit']} "
                    f"per portion looked wrong, used the default {qty:g} instead"
                )
            member_overrides.append({"dish_name": member["dish_name"], "qty": qty})

        bases_used = {}
        for dish_name in family["dishes"]:
            for entry in base_grams_by_dish_and_base.get(normalise(dish_name), []):
                bases_used.setdefault(entry["base"], entry["grams_per_portion"])

        results.append(
            {
                "name": family["name"],
                "type": family["type"],
                "dishes": family["dishes"],
                "portion_label": recipe.get("portion_label", ""),
                "main_item": {
                    "name": recipe["main_item_name"],
                    "unit": recipe["main_item_unit"],
                    "qty": main_qty,
                },
                "member_overrides": member_overrides,
                "bases_used": [
                    {"base": name, "grams_per_portion": g} for name, g in bases_used.items()
                ],
                "ingredients": recipe.get("ingredients", []),
                "minor_ingredients": recipe.get("minor_ingredients", []),
                "excluded_base_ingredients": excluded,
                "corrections": corrections,
            }
        )

    return {"families": results, "usage": usage}


def _merge_key(name: str) -> str:
    """Onion / Onions / Onion Chopped all collapse to the same key — strips a trailing plural 's'
    (len > 3, so "Peas"/"Oil" aren't mangled) and any prep-descriptor word, then normalises."""
    norm = normalise(name)
    words = [w for w in norm.split() if w not in _DESCRIPTOR_WORDS]
    words = [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in words]
    return " ".join(sorted(words)) or norm


def _guess_low_stock_category(name: str) -> str:
    norm = normalise(name)
    if any(kw in norm for kw in _PACKAGING_KEYWORDS):
        return "packaging_cleaning"
    if any(kw in norm for kw in _PERISHABLE_KEYWORDS):
        return "perishable"
    if any(kw in norm for kw in _DRY_STAPLE_KEYWORDS):
        return "dry_staples"
    return "dry_staples"


def _unit_family_guess(unit: str) -> str:
    return unit_family(unit)


def resolve_ingredients(family_results: list[dict], bases: list[dict], business=None) -> dict:
    """Collects every ingredient across the family recipes' main items + ingredients +
    minor_ingredients, plus every base's own batch ingredients, merges near-duplicate names, and
    matches each merged ingredient to an existing StockItem (fuzzy, business-scoped) or proposes it
    as new. Returns {"matched": [...], "new": [...]}; every entry carries `used_in` (dish/base
    names)."""
    raw: dict[str, dict] = {}  # merge key -> {"display_name", "unit", "used_in": set()}

    def _add(name: str, unit: str, used_in: str) -> None:
        key = _merge_key(name)
        entry = raw.setdefault(key, {"display_name": name, "unit": unit, "used_in": set()})
        entry["used_in"].add(used_in)
        # Prefer the shorter/cleaner display name once we have a choice between variants.
        if len(name) < len(entry["display_name"]):
            entry["display_name"] = name

    for family in family_results:
        dish_label = family["name"]
        main = family["main_item"]
        _add(main["name"], main["unit"], dish_label)
        for ing in family["ingredients"]:
            _add(ing["name"], ing["unit"], dish_label)
        for ing in family["minor_ingredients"]:
            _add(ing["name"], ing["unit"], dish_label)

    for base in bases:
        base_label = f"base: {base['name']}"
        for ing in base["batch_ingredients"]:
            _add(ing["name"], ing["unit"], base_label)

    stock_by_norm = stock_items_by_normalised_name(business) if business is not None else {}

    matched = []
    new = []
    for entry in raw.values():
        used_in = sorted(entry["used_in"])
        match = match_stock_item(stock_by_norm, entry["display_name"]) if stock_by_norm else None
        if match:
            stock_id, stock_name, stock_unit = match
            matched.append(
                {
                    "stock_item_id": stock_id,
                    "stock_item_name": stock_name,
                    "matched_from": entry["display_name"],
                    "used_in": used_in,
                }
            )
        else:
            new.append(
                {
                    "name": entry["display_name"],
                    "unit_family": _unit_family_guess(entry["unit"]),
                    "pack_size": None,
                    "low_stock_category": _guess_low_stock_category(entry["display_name"]),
                    "used_in": used_in,
                }
            )

    matched.sort(key=lambda m: m["stock_item_name"])
    new.sort(key=lambda n: n["name"])
    return {
        "matched": matched,
        "new": new,
        "matched_count": len(matched),
        "new_count": len(new),
    }


def suggest_setup(
    dishes: list[dict],
    sector: str,
    business=None,
    *,
    classify_fn=None,
    pick_fn=None,
    compose_fn=None,
    menu_scan=None,
) -> dict:
    """The one orchestrator entry point for Step EK-3. `dishes` must already be expanded
    (base_discovery.expand_dish_options + apply_groups), same contract as discover_bases. Returns
    {"best_sellers", "families", "bases", "ingredients", "cost_summary"} and, when `menu_scan` is
    given, also saves it onto menu_scan.result["setup"] so a later step (EK-4) can read it from
    there. Never writes to StockItem/SellItem/Recipe/Base — those only happen once the owner
    confirms, in a later step."""
    # discover_bases does its own daily/monthly limit gating around the (only) real classify call —
    # call it FIRST so classify_dishes below (same dish set) is always a cache hit, never a second
    # ungated call.
    bases_data = discover_bases(dishes, sector, [], business=business, classify_fn=classify_fn)
    bases = bases_data["bases"]
    classifications, classify_usage = classify_dishes(dishes, sector, classify_fn=classify_fn)

    stock_items: list[tuple[str, str]] = []
    if business is not None:
        stock_items = [
            (name, unit_family(unit))
            for _id, name, unit in business.stock_items.filter(active=True).values_list(
                "id", "name", "unit"
            )
        ]

    best_sellers_data = pick_best_sellers(
        dishes, classifications, sector, business, pick_fn=pick_fn
    )
    families = build_families(dishes, classifications)
    family_data = compose_family_recipes(
        families, bases, sector, stock_items, business, compose_fn=compose_fn
    )
    ingredients = resolve_ingredients(family_data["families"], bases, business)

    all_usage = (
        classify_usage + bases_data["usage"] + best_sellers_data["usage"] + family_data["usage"]
    )
    total_input = sum(u["input_tokens"] for u in all_usage)
    total_output = sum(u["output_tokens"] for u in all_usage)
    est_cost_usd = (
        Decimal(total_input) / Decimal(1_000_000) * settings.AI_PRICE_IN_PER_MTOK
        + Decimal(total_output) / Decimal(1_000_000) * settings.AI_PRICE_OUT_PER_MTOK
    )

    result = {
        "best_sellers": best_sellers_data["best_sellers"],
        "families": family_data["families"],
        "bases": bases,
        "ingredients": ingredients,
        "cost_summary": {
            "calls": len(all_usage),
            "input_tokens": total_input,
            "output_tokens": total_output,
            "est_cost_usd": str(est_cost_usd),
        },
    }

    if menu_scan is not None:
        menu_scan.result = {**(menu_scan.result or {}), "setup": result}
        menu_scan.save(update_fields=["result"])

    return result
