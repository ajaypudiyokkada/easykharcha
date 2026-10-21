"""Step 21d: what happens to a business's stock/sell items when its business_type changes and the
owner chose "Remove them and start fresh" (see BusinessUpdateView). Kept separate from views.py since
it reaches into four other apps' models — none of which import this module back."""

from counts.models import CountLine
from purchases.models import PurchaseLine
from sales.models import Sale
from stock.models import SellItem, StockItem
from wastage.models import WastageEntry


def remove_items_for_sector_change(business) -> dict:
    """Deletes every stock/sell item that's safe to delete, keeping (and reporting) anything that
    isn't: an item with history (purchases, counts, wastage, sales) or a stock item a surviving
    sell item still uses. Sell items are resolved and deleted first, since that's what decides
    which stock items are "still used by a sell item" afterward."""
    sell_items = list(business.sell_items.all())
    sell_item_ids_with_sales = set(
        Sale.objects.filter(sell_item__business=business).values_list("sell_item_id", flat=True)
    )
    sell_kept = []
    sell_remove_ids = []
    for item in sell_items:
        if item.id in sell_item_ids_with_sales:
            sell_kept.append({"name": item.name, "reason": "has sales history"})
        else:
            sell_remove_ids.append(item.id)
    sell_removed_count = len(sell_remove_ids)
    SellItem.objects.filter(id__in=sell_remove_ids).delete()

    stock_items = list(business.stock_items.all())
    history_ids = set(
        PurchaseLine.objects.filter(stock_item__business=business).values_list(
            "stock_item_id", flat=True
        )
    )
    history_ids |= set(
        CountLine.objects.filter(stock_item__business=business).values_list(
            "stock_item_id", flat=True
        )
    )
    history_ids |= set(
        WastageEntry.objects.filter(stock_item__business=business).values_list(
            "stock_item_id", flat=True
        )
    )
    # Only the sell items still standing after the delete above count as "in use" — one that was
    # itself just removed no longer protects the stock item it pointed to.
    in_use_ids = set(
        business.sell_items.exclude(main_stock_item=None).values_list(
            "main_stock_item_id", flat=True
        )
    )

    stock_kept = []
    stock_remove_ids = []
    for item in stock_items:
        if item.id in history_ids:
            stock_kept.append(
                {"name": item.name, "reason": "has purchase, count or wastage history"}
            )
        elif item.id in in_use_ids:
            stock_kept.append({"name": item.name, "reason": "used by a sell item"})
        else:
            stock_remove_ids.append(item.id)
    stock_removed_count = len(stock_remove_ids)
    StockItem.objects.filter(id__in=stock_remove_ids).delete()

    return {
        "stock_items_removed": stock_removed_count,
        "stock_items_kept": stock_kept,
        "sell_items_removed": sell_removed_count,
        "sell_items_kept": sell_kept,
    }
