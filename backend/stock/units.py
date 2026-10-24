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


# Step U1b-2: generic "packaged" entry-unit labels — a business typing a purchase/count/wastage/
# recipe quantity in packets/bags/tins/bottles/boxes rather than the item's own base unit. Only
# meaningful for a weight/volume item that has set `StockItem.pack_size_base_qty`; never applied to
# a count-family item (Decision 5, U1a report — a "bottle" stock item counts bottles as pieces, its
# own pack_size_base_qty if any is display-only, never base-unit maths).
PACK_ENTRY_UNITS = frozenset({"packet", "bag", "tin", "bottle", "box"})

# A weight/volume item's own base unit plus every entry-only alias that converts cleanly to it —
# the one table `entry_units_for` draws from before layering on pack units. Count-family items have
# no entry here: their only entry unit is the item's own `unit`, handled as the fallback below.
_FAMILY_ENTRY_FACTORS = {
    UnitFamily.WEIGHT: {"g": Decimal("1"), "kg": Decimal("1000"), "tonne": Decimal("1000000")},
    UnitFamily.VOLUME: {"ml": Decimal("1"), "L": Decimal("1000")},
}

# Base-unit storage precision (Decision 4, U1a report — kept at 3dp, unchanged) and the per-base-
# unit price precision (Decision 1 — widened to 4dp in U1b-1).
QUANTITY_QUANTUM = Decimal("0.001")
PRICE_QUANTUM = Decimal("0.0001")
# How far a stored amount displays as its major unit (1,000 g -> kg, 1,000 ml -> L) and back.
MAJOR_UNIT_FOR_FAMILY = {UnitFamily.WEIGHT: "kg", UnitFamily.VOLUME: "L"}
MAJOR_UNIT_FACTOR = Decimal("1000")


class UnitEntryError(ValueError):
    """A typed entry unit doesn't apply to this stock item — wrong family, or a pack unit with no
    pack size set yet. Pure Python, not a DRF exception: each app's view/serializer turns this into
    its own row-numbered validation error, same split as every other cross-row check in this repo."""


def entry_units_for(stock_item) -> dict[str, Decimal]:
    """Every entry unit this stock item accepts, mapped to its "how many base units is one of
    these" factor. A count-family item (and any weight/volume item with no pack size set) only ever
    accepts its own unit, factor 1."""
    factors = dict(_FAMILY_ENTRY_FACTORS.get(stock_item.unit_family, {}))
    if not factors:
        return {stock_item.unit: Decimal("1")}
    if stock_item.pack_size_base_qty:
        for pack_unit in PACK_ENTRY_UNITS:
            factors[pack_unit] = stock_item.pack_size_base_qty
    return factors


def _unit_error_message(unit: str, stock_item) -> str:
    if unit in PACK_ENTRY_UNITS and stock_item.unit_family in (
        UnitFamily.WEIGHT,
        UnitFamily.VOLUME,
    ):
        return "Set this item's pack size before entering packets/bags/tins/bottles."
    allowed = ", ".join(sorted(entry_units_for(stock_item)))
    return f"Enter this item's quantity in one of: {allowed}."


def convert_entry_quantity(quantity: Decimal, entry_unit: str | None, stock_item) -> Decimal:
    """A typed quantity, in `entry_unit` (None means "already the item's own base unit" — the
    pre-U1b-2 behaviour, so an old caller that never sends an entry unit keeps working unchanged),
    converted down to the stock item's base unit. Raises UnitEntryError for a unit this item
    doesn't accept (wrong family, or a pack unit with no pack size)."""
    unit = entry_unit or stock_item.unit
    factors = entry_units_for(stock_item)
    if unit not in factors:
        raise UnitEntryError(_unit_error_message(unit, stock_item))
    return (quantity * factors[unit]).quantize(QUANTITY_QUANTUM)


def convert_entry_price(
    price_per_entry_unit: Decimal, entry_unit: str | None, stock_item
) -> Decimal:
    """ "Rs 280 per kg" -> price per base unit (e.g. per gram), same entry-unit rules and errors as
    convert_entry_quantity."""
    unit = entry_unit or stock_item.unit
    factors = entry_units_for(stock_item)
    if unit not in factors:
        raise UnitEntryError(_unit_error_message(unit, stock_item))
    return (price_per_entry_unit / factors[unit]).quantize(PRICE_QUANTUM)


def _trim(value: Decimal) -> Decimal:
    """Up to 2 decimals, whole numbers shown without a trailing '.00'/'.X0' — e.g. 3.2, not 3.20;
    999, not 999.00. Decimal.normalize() is deliberately avoided: it can fall back to exponential
    notation (e.g. Decimal('999.00').normalize() == Decimal('9.99E+2')), which is fine for maths but
    wrong to hand back as a display string."""
    quantized = value.quantize(Decimal("0.01"))
    if quantized == quantized.to_integral():
        return quantized.quantize(Decimal(1))
    tenths = quantized.quantize(Decimal("0.1"))
    if quantized == tenths:
        return tenths
    return quantized


def display_quantity(base_qty: Decimal, unit: str) -> tuple[Decimal, str]:
    """A stored base-unit amount rolled up for display: >=1,000 g/ml shows as kg/L (up to 2
    decimals), otherwise the plain base number — whole numbers wherever possible either way."""
    family = unit_family(unit)
    major_unit = MAJOR_UNIT_FOR_FAMILY.get(family)
    if major_unit is not None and base_qty >= MAJOR_UNIT_FACTOR:
        return _trim(base_qty / MAJOR_UNIT_FACTOR), major_unit
    return _trim(base_qty), unit


def display_price_per_major_unit(base_price: Decimal | None, unit: str) -> Decimal | None:
    """The owner-facing price — always per kg/L for a weight/volume item, unchanged for anything
    else — never what's actually stored (price per base unit) or typed."""
    if base_price is None:
        return None
    family = unit_family(unit)
    if family in (UnitFamily.WEIGHT, UnitFamily.VOLUME):
        return (base_price * MAJOR_UNIT_FACTOR).quantize(Decimal("0.01"))
    return base_price.quantize(Decimal("0.01"))
