"""Matching each line of an imported bill to one of the owner's items you sell (Step S4b). The result
is a SUGGESTION stored in the draft: the owner confirms in the next step, and nothing is posted here.

Order, stopping at the first hit per line:
  a. a remembered alias for an item                 -> matched (source "remembered")
  b. a remembered "not an item" alias, or a charge word (parcel, packing, ...) in the name
                                                    -> not_an_item_suggested
  c. the exact normalised name of one of the items  -> matched (source "exact")
  d. fuzzy similarity: a clear, unambiguous >= 0.92 -> matched (source "close");
                       0.6 to 0.92, or a near tie   -> check_match with the best item + alternatives
  e. everything still unresolved goes to the AI in ONE call; its pick is ALWAYS check_match
  f. otherwise                                      -> unmatched
A failed AI call never fails the import: those lines just stay unmatched."""

import logging

from ai.limits import record_usage
from ai.models import AiUsageKind
from ai.provider import match_bill_lines
from ai.provider.errors import AiProviderCallError, AiSchemaError

from .models import AliasKind, SellItemAlias
from .normalize import normalize_name, similarity

logger = logging.getLogger(__name__)

CHARGE_WORDS = ("parcel", "packing", "packaging", "container", "delivery", "service charge")
CLOSE_SCORE = 0.92
CLOSE_MARGIN = 0.05
CHECK_SCORE = 0.6
ALTERNATIVE_MIN_SCORE = 0.4
MAX_ALTERNATIVES = 3


def has_charge_word(normalised: str) -> bool:
    padded = f" {normalised} "
    return any(f" {word} " in padded for word in CHARGE_WORDS)


def _item_ref(item: dict, score: float | None = None) -> dict:
    ref = {"sell_item_id": item["id"], "name": item["name"]}
    if score is not None:
        ref["score"] = score
    return ref


def _match(
    state: str, source: str, *, item=None, suggestion=None, alternatives=None, score=None
) -> dict:
    return {
        "state": state,
        "source": source,
        "sell_item_id": item["id"] if item else None,
        "sell_item_name": item["name"] if item else None,
        "suggestion": suggestion,
        "alternatives": alternatives or [],
        "score": score,
    }


def _first_pass(
    name: str, items: list[dict], aliases: dict
) -> tuple[dict | None, list[tuple[float, dict]]]:
    """Steps a to d for one line. Returns (match, scored items best-first); match is None when the
    line is still unresolved."""
    norm = normalize_name(name)
    by_id = {item["id"]: item for item in items}
    alias = aliases.get(norm)
    if alias is not None and alias.kind == AliasKind.ITEM and alias.sell_item_id in by_id:
        return _match("matched", "remembered", item=by_id[alias.sell_item_id], score=1.0), []
    if (alias is not None and alias.kind == AliasKind.NOT_ITEM) or has_charge_word(norm):
        source = "remembered" if alias is not None else "charge_word"
        return _match("not_an_item_suggested", source), []
    for item in items:
        if item["norm"] == norm:
            return _match("matched", "exact", item=item, score=1.0), []

    scored = sorted(((similarity(norm, item["norm"]), item) for item in items), key=lambda p: -p[0])
    if not scored:
        return None, scored
    best_score, best = scored[0]
    second_score = scored[1][0] if len(scored) > 1 else 0.0
    others = [
        _item_ref(item, score) for score, item in scored[1:] if score >= ALTERNATIVE_MIN_SCORE
    ][:MAX_ALTERNATIVES]
    if best_score >= CLOSE_SCORE and best_score - second_score >= CLOSE_MARGIN:
        return _match("matched", "close", item=best, score=best_score), scored
    if best_score >= CHECK_SCORE:
        return (
            _match(
                "check_match",
                "fuzzy",
                suggestion=_item_ref(best, best_score),
                alternatives=others,
                score=best_score,
            ),
            scored,
        )
    return None, scored


def match_lines(imp, lines: list[dict], *, provider=None, record: bool = True) -> None:
    """Adds `line_id` and `match` to each line dict, in place. `provider`/`record` exist so the
    real-bill script can run matching read-only (its own provider, no AiUsage row)."""
    items = [
        {"id": row["id"], "name": row["name"], "norm": normalize_name(row["name"])}
        for row in imp.business.sell_items.filter(active=True).values("id", "name")
    ]
    aliases = {a.normalized_alias: a for a in SellItemAlias.objects.filter(business=imp.business)}

    unresolved: list[tuple[dict, list]] = []
    for index, line in enumerate(lines, start=1):
        line["line_id"] = f"l{index}"
        match, scored = _first_pass(line["name_as_printed"], items, aliases)
        if match is None:
            unresolved.append((line, scored))
            line["match"] = _match("unmatched", "none")
        else:
            line["match"] = match

    if not unresolved or not items:
        return

    ai_picks = _ask_ai(imp, [line for line, _ in unresolved], items, provider, record)
    by_id = {item["id"]: item for item in items}
    for line, scored in unresolved:
        pick = ai_picks.get(line["line_id"])
        if pick and pick["sell_item_id"] in by_id:
            item = by_id[pick["sell_item_id"]]
            # An AI pick is never "matched": the owner always confirms it.
            line["match"] = _match(
                "check_match",
                "ai",
                suggestion=_item_ref(item, pick["confidence"]),
                alternatives=[
                    _item_ref(other, score)
                    for score, other in scored
                    if other["id"] != item["id"] and score >= ALTERNATIVE_MIN_SCORE
                ][:MAX_ALTERNATIVES],
                score=pick["confidence"],
            )


def _ask_ai(
    imp, lines: list[dict], items: list[dict], provider=None, record: bool = True
) -> dict[str, dict]:
    """ONE call for every unresolved line. Any failure just means no suggestions."""
    payload_lines = [{"line_id": ln["line_id"], "name": ln["name_as_printed"]} for ln in lines]
    payload_items = [{"id": i["id"], "name": i["name"]} for i in items]
    try:
        result = (provider or match_bill_lines)(payload_lines, payload_items)
    except (AiProviderCallError, AiSchemaError):
        logger.warning("invoice match call failed for import %s; lines stay unmatched", imp.id)
        return {}
    except Exception:  # noqa: BLE001 - matching is a bonus; it must never fail the import
        logger.exception("invoice match call crashed for import %s", imp.id)
        return {}
    if record:
        record_usage(
            business=imp.business,
            kind=AiUsageKind.INVOICE_MATCH,
            model=result.model,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
        )
    return {m["line_id"]: m for m in result.data["matches"] if m["sell_item_id"] is not None}
