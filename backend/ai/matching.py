"""Server-side name matching — the model's matched_stock_name is only a hint (prompts.py asks for
it, but never trusts it); the actual stock-item link is always resolved here, normalised and fuzzy,
against this business's own stock items."""

import difflib
import re

_WHITESPACE = re.compile(r"\s+")

FUZZY_CUTOFF = 0.82


def normalise(name: str) -> str:
    return _WHITESPACE.sub(" ", name.strip().lower())


def existing_dish_names(business) -> set[str]:
    return {normalise(name) for name in business.sell_items.values_list("name", flat=True)}


def stock_items_by_normalised_name(business) -> dict[str, tuple[int, str]]:
    return {
        normalise(name): (item_id, name)
        for item_id, name in business.stock_items.filter(active=True).values_list("id", "name")
    }


def match_stock_item(stock_by_norm: dict[str, tuple[int, str]], name_hint: str | None):
    """Returns (stock_item_id, stock_item_name) for the best match, or None."""
    if not name_hint:
        return None
    norm = normalise(name_hint)
    if norm in stock_by_norm:
        return stock_by_norm[norm]
    close = difflib.get_close_matches(norm, stock_by_norm.keys(), n=1, cutoff=FUZZY_CUTOFF)
    return stock_by_norm[close[0]] if close else None
