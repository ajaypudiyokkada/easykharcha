"""Step U2b1b2 (docs/BASES_PLAN.md secs 1-2, 8.2): the one-level base-to-raw expansion that
counts/gap.py's gap_for_line folds into its confirmed/unconfirmed expected-usage split, so the gap
maths never cares whether a stock item reaches a dish directly or through a base's batch formula.

Pure read/aggregation, no state — mirrors stock/units.py's "nothing here talks to anything but the
database read path" discipline so gap.py, a future alerts/service.py low_stock reader and a future
shopping-list read can all import this one function instead of computing it differently."""

from decimal import Decimal

from businesses.models import Business

from .models import BaseIngredient, SellItem, SellItemIngredient, StockItem

ONE_THOUSAND = Decimal("1000")


def quantity_per_portion_by_sell_item(
    business: Business, stock_item: StockItem
) -> dict[SellItem, Decimal]:
    """Every active sell item that uses `stock_item`, mapped to how much of it one portion uses.
    Two contributions, summed when both apply to the same dish (not excluded by the data model):
    the dish's own direct SellItemIngredient.quantity, plus, for every base containing this stock
    item, that base's SellItemBase.quantity (per dish using the base) scaled by the base's
    BaseIngredient.quantity_per_1000 / 1,000. One level only: a base's own stock_item can never be
    another Base (see BaseIngredient's docstring), so there is nothing further to expand."""
    totals: dict[SellItem, Decimal] = {}

    direct_rows = SellItemIngredient.objects.filter(
        stock_item=stock_item, sell_item__business=business, sell_item__active=True
    ).select_related("sell_item")
    for row in direct_rows:
        totals[row.sell_item] = totals.get(row.sell_item, Decimal("0")) + row.quantity

    base_ingredient_rows = BaseIngredient.objects.filter(
        stock_item=stock_item, base__business=business
    ).select_related("base")
    for base_ingredient in base_ingredient_rows:
        sell_item_base_rows = base_ingredient.base.used_in.filter(
            sell_item__business=business, sell_item__active=True
        ).select_related("sell_item")
        for sell_item_base in sell_item_base_rows:
            contribution = sell_item_base.quantity * (
                base_ingredient.quantity_per_1000 / ONE_THOUSAND
            )
            totals[sell_item_base.sell_item] = (
                totals.get(sell_item_base.sell_item, Decimal("0")) + contribution
            )

    return totals
