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
# — part of the per-menu cache key, same role as prompts.py's *_PROMPT_VERSION constants. Step EK-2c
# bumped 1->2: new types (plain_fried_snack/dry_masala_fry/gravy_thai/butter_garlic/bread_maida) and
# keyword_type_overrides change which bases a given dish set maps to.
MAPPING_VERSION = 2

_OVERFILL_TOLERANCE = 0.15
_MAX_PORTION_GRAMS = 600

# Strips a trailing "(...)" decoration off a heading, e.g. "Chicken Wings (Hot Garlic / BBQ /
# Crispy)" -> "Chicken Wings" — expand_dish_options combines THIS bare phrase with each variant,
# never the raw name-with-parentheses (which would otherwise be glued onto every expanded dish).
_TRAILING_PAREN = re.compile(r"\s*\([^()]*\)\s*$")


def _variant_already_in_heading(variant: str, heading_norm: str) -> bool:
    """Step EK-3d Fix B: a variant that's already a whole phrase INSIDE the heading (not just an exact
    match of the whole heading) is the same model slip as the exact-match case, just partial — e.g. a
    heading "CHICKEN LOLLIPOP / DRUMS OF HEAVEN" with a stray variant "Drums of Heaven" would otherwise
    glue the heading's own second half back onto itself ("... Drums of Heaven"). Checked before the
    variant is ever combined, never after."""
    phrase = normalise(variant)
    return bool(phrase) and bool(re.search(rf"\b{re.escape(phrase)}\b", heading_norm))


def expand_dish_options(dishes: list[dict]) -> list[dict]:
    """Turns one menu row carrying 2+ `variants` (schemas.ExtractedDish — set for both an inline
    "Chicken (Manchurian/Chilli)" line and a heading-plus-separate-choices group like a "MANCHURIAN"
    heading over "Gobi/Paneer/Babycorn/Mushroom") into one real dish per variant, combined according
    to `variant_position` ("prefix": heading + variant, the common case; "suffix": variant +
    heading). `variant_prices`, when present, gives each expanded dish its own price instead of the
    row's single price. Deterministic, no model call. Each expanded row carries `expanded_from` (the
    original heading text) so a future review screen can flag it. A dish with fewer than 2 variants
    passes through unchanged — it is never left in the output named only by its bare heading. A
    variant that normalises the same as the heading, or is already a whole phrase inside it
    (_variant_already_in_heading), is dropped before combining (a model slip that would otherwise glue
    the same words onto themselves, e.g. "Gulab Jamun Gulab Jamun" or "... Drums of Heaven")."""
    expanded = []
    for dish in dishes:
        heading = _TRAILING_PAREN.sub("", dish.get("name", "")).strip() or dish.get("name", "")
        heading_norm = normalise(heading)
        variants = [
            v
            for v in (dish.get("variants") or [])
            if v
            and normalise(v) != heading_norm
            and not _variant_already_in_heading(v, heading_norm)
        ]
        if len(variants) < 2:
            expanded.append(dish)
            continue
        position = dish.get("variant_position") or "prefix"
        variant_prices = dish.get("variant_prices")
        for index, option in enumerate(variants):
            name = f"{heading} {option}" if position == "prefix" else f"{option} {heading}"
            row = {**dish, "name": name, "expanded_from": dish.get("name", "")}
            if variant_prices and index < len(variant_prices):
                row["price"] = variant_prices[index]
            expanded.append(row)
    return expanded


_PUNCT = re.compile(r"[^\w\s]")


def _dedup_key(name: str) -> str:
    """lowercase, strip punctuation, sort the UNIQUE tokens — so "Gobi Manchurian" and "Manchurian
    Gobi" (the same dish built by two different passes in the opposite word order) collide on the
    same key, and so does a doubled-up name like "Gulab Jamun Gulab Jamun" against "Gulab Jamun"."""
    return " ".join(sorted(set(_PUNCT.sub(" ", name.lower()).split())))


def _name_cleanliness_score(name: str) -> float:
    """Lower is cleaner — used by dedup_dishes to pick which of two matching rows' names to keep."""
    score = len(name) * 0.01
    words = name.split()
    score += 5 * sum(
        1 for w in words if len(w) > 1 and w.isupper()
    )  # an ALL-CAPS word, whole or partial
    lowered = [w.lower() for w in words]
    if any(a == b for a, b in zip(lowered, lowered[1:], strict=False)):
        score += 20  # "GULAB JAMUN GULAB JAMUN" — the same word (or phrase) repeated back to back
    return score


_REPEATED_PHRASE = re.compile(r"\b(\w+\s+\w+)\s+\1\b", re.IGNORECASE)
_REPEATED_WORD = re.compile(r"\b(\w+)\s+\1\b", re.IGNORECASE)


def _drop_repeated_word(name: str) -> str:
    """Step EK-3b Fix F: a leftover like "Gobi Manchurian/65 65" or "MIXED FRIED RICE/SCHEZWAN
    SCHEZWAN" — a word doubled back-to-back, almost always a slash/variant artifact — collapses to
    one occurrence. Only fires on an exact, adjacent repeat, never a dish that's legitimately named
    with a repeated word elsewhere (e.g. "Dal Dal Makhani" wouldn't match since "Dal"/"Makhani" aren't
    adjacent-identical in that order anyway — this is deliberately conservative). Step EK-3d Fix B:
    the same artifact can double a whole 2-word PHRASE, not just one word (e.g. "Fish Masala Fry
    Masala Fry") — checked first, since collapsing the phrase first then leaves no partial single-word
    repeat behind for the word-level regex to (harmlessly) re-check."""
    name = _REPEATED_PHRASE.sub(r"\1", name)
    return _REPEATED_WORD.sub(r"\1", name)


_WORD = re.compile(r"[a-z0-9]+")


def _word_tokens(name: str) -> set[str]:
    """Punctuation-aware tokenising ("Rice/Noodles" -> {"rice", "noodles"}), unlike a plain
    .split() — needed for matching against a slash/comma-garbled leftover name."""
    return set(_WORD.findall(normalise(name)))


_SLASH_SPLIT = re.compile(r"\s*/\s*")


def _split_slash_name(name: str) -> tuple[str, str] | None:
    if name.count("/") != 1:
        return None
    left, right = _SLASH_SPLIT.split(name, maxsplit=1)
    left, right = left.strip(), right.strip()
    return (left, right) if left and right else None


def _resolve_slash_name(dish: dict) -> dict:
    """Step EK-3d Fix B: a dish name left with exactly one "A / B" split (no separate prices, no
    group-pass result — those are handled earlier) is kept as ONE dish. When A and B share a real word
    (len >= 3) — "Fish Masala Fry" / "Tava Fry" both end in "Fry" — they read as two styles of the
    SAME base dish, so only the fuller side (A) is kept, flagged "check this" rather than guessed at.
    When they share nothing — "Chicken Lollipop" / "Drums of Heaven" — they're two names for one dish;
    kept combined, exactly as written, unflagged."""
    parts = _split_slash_name(dish["name"])
    if parts is None:
        return dish
    left, right = parts
    left_words = {w for w in _word_tokens(left) if len(w) >= 3}
    right_words = {w for w in _word_tokens(right) if len(w) >= 3}
    if left_words & right_words:
        return {**dish, "name": left, "note": "check this"}
    return dish


def _resolve_slash_names(dishes: list[dict]) -> list[dict]:
    return [_resolve_slash_name(d) for d in dishes]


_BARE_VS_SPECIFIC_OPTION_WORDS = {
    "veg",
    "nonveg",
    "non",
    "chicken",
    "egg",
    "mixed",
    "prawn",
    "red",
    "green",
}


def _drop_bare_duplicates(dishes: list[dict]) -> list[dict]:
    """Step EK-3d Fix C: a bare heading-only row (e.g. "Sweetcorn Soup") surviving next to its own
    more specific siblings (e.g. "Sweetcorn Soup Veg"/"Sweetcorn Soup Chicken") is the same table's
    generic label the first pass also emitted standalone, not a genuine third choice — dropped when
    some other dish's words are an exact superset adding exactly one recognised option word."""
    token_sets = [_word_tokens(d["name"]) for d in dishes]
    drop: set[int] = set()
    for i, tokens_a in enumerate(token_sets):
        if not tokens_a:
            continue
        for j, tokens_b in enumerate(token_sets):
            if i == j:
                continue
            extra = tokens_b - tokens_a
            if (
                tokens_a < tokens_b
                and len(extra) == 1
                and next(iter(extra)) in _BARE_VS_SPECIFIC_OPTION_WORDS
            ):
                drop.add(i)
                break
    return [d for idx, d in enumerate(dishes) if idx not in drop]


def dedup_dishes(dishes: list[dict]) -> list[dict]:
    """Fix A: one source of truth downstream of expand_dish_options/apply_groups — merges any two
    rows that are the same dish once normalised and word-order-independent (duplicates between the
    first pass's own expansion and the dedicated group pass, or within either one alone), keeping
    whichever row's name is cleaner (not all-caps, no back-to-back repeated word) and that row's own
    price. Order-preserving: a merged dish keeps its first occurrence's position. Step EK-3b Fix F:
    also strips a back-to-back repeated word from every surviving name (e.g. "... 65 65" -> "... 65")
    even when there's no duplicate row to merge against."""
    dishes = [{**d, "name": _drop_repeated_word(d["name"])} for d in dishes]
    best_by_key: dict[str, dict] = {}
    order: list[str] = []
    for dish in dishes:
        key = _dedup_key(dish["name"])
        if key not in best_by_key:
            best_by_key[key] = dish
            order.append(key)
            continue
        current = best_by_key[key]
        if _name_cleanliness_score(dish["name"]) < _name_cleanliness_score(current["name"]):
            best_by_key[key] = {**current, **dish}
    return [best_by_key[key] for key in order]


def _is_choice_fragment(name: str, group_dish_token_sets: list[set[str]]) -> bool:
    """A standalone dish the first pass emitted that's really just one choice-word from a group it
    didn't recognise as a group at all (e.g. a bare "Veg" row beside a "Fried Rice/Noodles" table
    that the dedicated group pass correctly read as "Fried Rice Veg"/"Noodles Veg"/...) — true when
    its own name's tokens are a proper subset of 2+ of that SAME group's own final dish names, the
    signature of a column label the first pass misread as its own dish."""
    tokens = set(normalise(name).split())
    if not tokens:
        return False
    return sum(1 for dish_tokens in group_dish_token_sets if tokens < dish_tokens) >= 2


_BLOB_BRACKETED = re.compile(r"\([^()]*\)")


def _is_blob_leftover(
    name: str, heading_tokens: set[str], group_dish_token_sets: list[set[str]]
) -> bool:
    """Step EK-3d Fix A: a first-pass dish covering the same table a group pass already handled, in
    either of two shapes real menus produced. (1) The whole table garbled into one dish name (e.g.
    "Fried Rice/Noodles Veg/Egg/Chicken/Mixed (Egg, Chicken, Pork, Prawns, Mutton)") — true when the
    dish's own words fully contain the group heading's words AND it carries strictly more words than
    the group's own widest real dish. (2) expand_dish_options DID split the row into one dish per
    option, but combined with the heading's own compound, slash-joined text ("Fried Rice/Noodles
    Chicken") where the group pass split that same heading into two separate real dishes ("Fried Rice
    Chicken" + "Noodles Chicken") — true when some one real group dish's full words are entirely
    contained in this dish's words, with only heading vocabulary (never anything else) left over."""
    if not heading_tokens:
        return False
    # Real menus explain a "Mixed" option with its own parenthetical ("Mixed (Egg, Chicken, Pork,
    # Prawns, Mutton)") — real content, not a bug, but irrelevant to telling this dish apart from the
    # group pass's plain "Fried Rice Mixed"/"Noodles Mixed", so it's dropped before comparing tokens.
    tokens = _word_tokens(_BLOB_BRACKETED.sub(" ", name))
    if heading_tokens <= tokens:
        widest_real_dish = max((len(s) for s in group_dish_token_sets), default=0)
        if len(tokens) > widest_real_dish:
            return True
    for gd_tokens in group_dish_token_sets:
        if gd_tokens and gd_tokens <= tokens:
            extra = tokens - gd_tokens
            if extra and extra <= heading_tokens:
                return True
    return False


def apply_groups(dishes: list[dict], groups: list[dict]) -> list[dict]:
    """Step EK-2b/EK-2c: runs AFTER expand_dish_options, using the dedicated group pass's output
    (extraction.MenuExtractionOutcome.groups, prompts.GROUP_SYSTEM_PROMPT) as the SINGLE source of
    truth for any heading it recognised — the group pass now returns the final combined dish names
    directly (e.g. heading "MANCHURIAN" -> dishes ["Gobi Manchurian", "Paneer Manchurian"]), not a
    prefix/suffix label to recombine. For every discovered group: drops every dish the first pass
    already produced for that same heading — whether it was a broken bare leftover like just
    "Manchurian", a clean-looking expansion built from the row's own `variants` (even word-order-
    reversed, e.g. "Manchurian Gobi" vs the group's "Gobi Manchurian" — Step EK-3d Fix A: matched by
    _dedup_key, not exact string, so the group's own name always wins a tie), or a whole-table blob
    the first pass produced as a single dish (_is_blob_leftover) — drops any standalone choice-word
    fragment left over from the SAME table (_is_choice_fragment, e.g. a bare "Veg" row beside a Fried
    Rice/Noodles price table); then adds the group's own dish rows. A final dedup_dishes pass (plus
    slash-name resolution and bare-vs-specific pruning) catches anything still duplicated across the
    two passes or within either one alone. Deterministic, no model call. A menu with no groups still
    runs through the same final cleanup passes."""
    if not groups:
        return _drop_bare_duplicates(_resolve_slash_names(dedup_dishes(dishes)))

    group_heading_norms = {normalise(g["heading"]) for g in groups}
    group_dish_keys = {_dedup_key(gd["name"]) for g in groups for gd in g.get("dishes", [])}
    kept = [
        dish
        for dish in dishes
        if normalise(dish.get("expanded_from") or dish["name"]) not in group_heading_norms
        and _dedup_key(dish["name"]) not in group_dish_keys
    ]
    for group in groups:
        group_dish_token_sets = [
            set(normalise(gd["name"]).split()) for gd in group.get("dishes", [])
        ]
        heading_tokens = {w for w in _word_tokens(group["heading"]) if len(w) >= 3}
        kept = [
            d
            for d in kept
            if not _is_choice_fragment(d["name"], group_dish_token_sets)
            and not _is_blob_leftover(d["name"], heading_tokens, group_dish_token_sets)
        ]

    existing_names = {normalise(dish["name"]) for dish in kept}
    for group in groups:
        for group_dish in group.get("dishes", []):
            key = normalise(group_dish["name"])
            if key in existing_names:
                continue
            existing_names.add(key)
            kept.append(
                {
                    "name": group_dish["name"],
                    "price": group_dish.get("price"),
                    "confidence": 0.8,
                    "expanded_from": group["heading"],
                }
            )
    return _drop_bare_duplicates(_resolve_slash_names(dedup_dishes(kept)))


def _cache_key(dish_names: list[str]) -> str:
    normalised = sorted({normalise(name) for name in dish_names})
    return hashlib.sha256("|".join(normalised).encode("utf-8")).hexdigest()


def _secondary_types_for(name: str, primary_type: str, rules: dict) -> list[str]:
    """Step EK-2d Fix B: deterministic, model-independent — a dish naming both a protein/veg AND a
    frying style (chilli, manchurian, 65, pepper, lollipop, wings, finger, pakoda, fry) is battered
    AND tossed in sauce in a real kitchen, but the model's classify_dishes can only pick one primary
    type. Whichever of the pair (fried_starter_dry/fried_starter_tossed) ISN'T the primary gets added
    as well — regardless of what the model said, so run-to-run model variance on this split can't
    starve either base. Never fires for a type outside this pair (fries/nuts/mutton-fry/tandoori/
    soups/Thai keep their own no-base types untouched)."""
    rule = rules.get("two_base_starter_rule")
    if not rule or primary_type not in rule.get("add_bases_for_types", []):
        return []
    name_norm = normalise(name)
    has_protein = any(kw in name_norm for kw in rule["protein_keywords"])
    has_style = any(kw in name_norm for kw in rule["style_keywords"])
    if not (has_protein and has_style):
        return []
    return [t for t in rule["add_bases_for_types"] if t != primary_type]


def map_bases_from_classification(
    dishes: list[dict], classifications: dict[str, dict], library: dict
) -> list[dict]:
    """The deterministic replacement for the old model-driven mapping (EK-1): for every dish, look
    its classified type up in the sector's type_rules to find the base(s) it uses and how many
    grams/ml per portion (a family_overrides entry, e.g. "mutton": 220, wins over the type's own
    default). Never asks the model to invent a base, a formula, or a quantity — only which type(s) a
    dish is. A type with no rule (null in type_rules, or missing) contributes no base. Step EK-2d: a
    dish can map to up to 2 bases now — its primary type, PLUS classification.py's optional
    model-reported `secondary_type` and/or _secondary_types_for's deterministic addition (a fried
    starter genuinely using both a batter and a sauce base) — never more than the 2 real bases the
    fried_starter_dry/fried_starter_tossed pair can contribute."""
    type_rules = library.get("type_rules", {})
    templates_by_name = {t["name"]: t for t in library.get("base_templates", [])}
    excluded = set(library.get("rules", {}).get("excluded_by_default", []))
    rules = library.get("rules", {})

    groups: dict[str, list[dict]] = {}

    def add_mapping(name: str, dish_type: str, family: str) -> None:
        rule = type_rules.get(dish_type)
        if not rule:
            return
        base_name = rule["base"]
        if base_name in excluded or base_name not in templates_by_name:
            return
        bucket = groups.setdefault(base_name, [])
        if any(entry["dish"] == name for entry in bucket):
            return  # already mapped to this same base via another type — never double-list a dish
        grams = rule.get("family_overrides", {}).get(family, rule["grams_per_portion"])
        bucket.append({"dish": name, "grams_per_portion": grams, "family": family or dish_type})

    for dish in dishes:
        name = dish["name"]
        info = classifications.get(normalise(name), {"type": "other", "family": ""})
        primary_type = info["type"]
        family = (info.get("family") or "").lower()

        add_mapping(name, primary_type, family)

        secondary_type = (info.get("secondary_type") or "").strip()
        if secondary_type and secondary_type != primary_type:
            add_mapping(name, secondary_type, family)

        for extra_type in _secondary_types_for(name, primary_type, rules):
            add_mapping(name, extra_type, family)

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
