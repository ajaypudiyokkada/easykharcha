"""Step U1b-1: the one shared unit-family/base-unit module — used today by the base-unit backfill
migration and `ai/matching.py`, and from U1b-2 onward by every quantity-entry screen's serializer
(purchases/counts/wastage/recipe rows) to convert a typed kg/L/tonne/pack amount down to the stock
item's stored base unit before it's saved. Nothing here talks to the database — pure lookups/maths
only, so a migration can import it safely without depending on app state at a particular point in
history (the backfill migration keeps its own frozen copy of the mapping instead, since a migration
must never change behaviour if this module changes later — see that migration's docstring)."""

from decimal import Decimal


class UnitFamily:
    WEIGHT = "weight"
    VOLUME = "volume"
    COUNT = "count"

    CHOICES = [
        (WEIGHT, "Weight"),
        (VOLUME, "Volume"),
        (COUNT, "Count"),
    ]


# Every stock Unit (stock.models.Unit) mapped to the family it belongs to. `kg`/`L`/`tonne` are
# entry-only aliases for the weight/volume families (a StockItem's own `unit` is never one of them
# once the base-unit migration has run) — they still need an entry here so a purchase/count/
# wastage/recipe entry screen can convert a typed "25 kg" against an item whose stored unit is "g".
# `bottle` is a count-family pack unit (Decision 5 — U1b-1 report): a business counts bottles as
# discrete pieces; `StockItem.pack_size_base_qty` may record one bottle's liquid size (e.g. 750 ml)
# for display only, never for base-unit maths. Every other label (piece/pack/dozen/m/sheet/roll/
# set/box/bag/tray) has no sibling unit and stays its own one-member count family, same as today.
UNIT_FAMILY = {
    "kg": UnitFamily.WEIGHT,
    "g": UnitFamily.WEIGHT,
    "tonne": UnitFamily.WEIGHT,
    "L": UnitFamily.VOLUME,
    "ml": UnitFamily.VOLUME,
}

# The one stored base unit for a convertible family — count has none (a count item's own unit,
# whatever it is, is already its base unit).
BASE_UNIT_FOR_FAMILY = {
    UnitFamily.WEIGHT: "g",
    UnitFamily.VOLUME: "ml",
}

# "How many base units is one of these" — only entry-only aliases need a factor; a stock item's own
# base unit (g, ml, or any count label) never does, since no conversion happens for it.
ENTRY_UNIT_TO_BASE_FACTOR = {
    "kg": Decimal("1000"),
    "tonne": Decimal("1000000"),
    "L": Decimal("1000"),
}


def unit_family(unit: str) -> str:
    return UNIT_FAMILY.get(unit, UnitFamily.COUNT)


def base_unit_for(unit: str) -> str:
    """The base unit `unit` ultimately stores as — itself, unless it's an entry-only alias."""
    family = unit_family(unit)
    return BASE_UNIT_FOR_FAMILY.get(family, unit)
