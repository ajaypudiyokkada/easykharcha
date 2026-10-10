"""Mapping POS item names to dishes.

The rule that matters: **fuzzy never auto-accepts.** Exact alias and exact name are safe because they
are exact. A fuzzy match is a guess, and a wrong guess silently moves one dish's plates onto another —
which corrupts the expected-usage figure for both, and the variance report then reports a loss that
never happened. So fuzzy output is only ever a ranked suggestion for a human to confirm.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from rapidfuzz import fuzz, process

from core.fields import ZERO, d
from imports.parsers.base import ParsedRow, normalise_item
from inventory.models import Dish, DishAlias

#: Below this a suggestion is noise and showing it invites a careless confirm.
SUGGESTION_FLOOR = 60


@dataclass
class MatchedGroup:
    """One dish on one business date, aggregated from however many POS lines."""

    dish: Dish
    business_date: object
    plates: Decimal = ZERO
    revenue: Decimal = ZERO
    source_rows: int = 0
    channels: set = field(default_factory=set)


@dataclass
class UnmatchedItem:
    item_name: str
    plates: Decimal = ZERO
    revenue: Decimal = ZERO
    rows: int = 0
    suggestions: list = field(default_factory=list)


class DishIndex:
    """Lookup table for one tenant, built once per import."""

    def __init__(self, business):
        self.dishes = list(Dish.objects.filter(business=business))
        self.by_id = {dish.id: dish for dish in self.dishes}

        #: normalised name -> (dish, plate_multiplier)
        self.exact: dict[str, tuple[Dish, Decimal]] = {}
        # Dish name first, then pos_alias, then DishAlias — later writes win, so an explicit alias
        # beats an incidental name collision.
        for dish in self.dishes:
            self.exact.setdefault(normalise_item(dish.name), (dish, Decimal("1")))
        for dish in self.dishes:
            if dish.pos_alias:
                self.exact[normalise_item(dish.pos_alias)] = (dish, Decimal("1"))
        for alias in DishAlias.objects.filter(business=business).select_related("dish"):
            self.exact[alias.normalised] = (alias.dish, d(alias.plate_multiplier))

        self._choices = {normalise_item(dish.name): dish for dish in self.dishes}

    def lookup(self, item_name: str) -> tuple[Dish, Decimal] | None:
        return self.exact.get(normalise_item(item_name))

    def suggest(self, item_name: str, limit: int = 3) -> list[dict]:
        """Ranked suggestions. Never applied automatically."""
        if not self._choices:
            return []
        results = process.extract(
            normalise_item(item_name),
            list(self._choices.keys()),
            scorer=fuzz.WRatio,
            limit=limit,
        )
        out = []
        for key, score, _ in results:
            if score < SUGGESTION_FLOOR:
                continue
            dish = self._choices[key]
            out.append({"dish": dish.id, "dish_name": dish.name, "score": round(score / 100, 3)})
        return out


def match(business, rows: list[ParsedRow]) -> dict:
    """Aggregate parsed rows to (dish, business_date) and report what could not be matched."""
    index = DishIndex(business)
    matched: dict[tuple[int, object], MatchedGroup] = {}
    unmatched: dict[str, UnmatchedItem] = {}

    for row in rows:
        found = index.lookup(row.item_name)
        if found is None:
            entry = unmatched.get(row.item_name)
            if entry is None:
                entry = UnmatchedItem(
                    item_name=row.item_name, suggestions=index.suggest(row.item_name)
                )
                unmatched[row.item_name] = entry
            entry.plates += d(row.qty)
            entry.revenue += d(row.amount)
            entry.rows += 1
            continue

        dish, multiplier = found
        key = (dish.id, row.business_date)
        group = matched.get(key)
        if group is None:
            group = MatchedGroup(dish=dish, business_date=row.business_date)
            matched[key] = group
        group.plates += d(row.qty) * multiplier
        group.revenue += d(row.amount)
        group.source_rows += 1
        if row.channel:
            group.channels.add(row.channel)

    return {
        "matched": sorted(matched.values(), key=lambda g: (g.business_date, g.dish.name)),
        "unmatched": sorted(unmatched.values(), key=lambda u: -u.revenue),
        "index": index,
    }


def apply_aliases(business, aliases: dict) -> int:
    """Persist `{pos item name: dish_id}` or `{name: {dish, plate_multiplier}}` mappings.

    Saved before the final match so newly mapped items land in `matched` on the same request.
    """
    saved = 0
    for item_name, value in (aliases or {}).items():
        if isinstance(value, dict):
            dish_id = value.get("dish")
            multiplier = d(value.get("plate_multiplier", 1) or 1)
        else:
            dish_id, multiplier = value, Decimal("1")
        if not dish_id:
            continue
        dish = Dish.objects.filter(pk=dish_id, business=business).first()
        if dish is None:
            continue
        DishAlias.objects.update_or_create(
            business=business,
            normalised=normalise_item(item_name),
            defaults={"dish": dish, "pos_name": item_name, "plate_multiplier": multiplier},
        )
        saved += 1
    return saved
