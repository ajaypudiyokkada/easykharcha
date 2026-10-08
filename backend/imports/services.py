"""Matching POS rows to dishes and writing them as Sales (§5c).

The product's position, worth restating because it shapes this code: we reconcile physical counts against
sales. We do not maintain a perpetual system inventory. So an import only ever writes Sale rows — it
never touches stock.
"""

from collections import defaultdict
from difflib import SequenceMatcher

from django.db import transaction
from django.utils import timezone

from audit.services import log
from core.fields import d
from inventory.models import Dish, Sale, SalesImport, SaleSource


def _index_dishes(business) -> tuple[dict, list]:
    dishes = list(Dish.objects.filter(business=business))
    index = {}
    for dish in dishes:
        if dish.pos_alias:
            index[dish.pos_alias.strip().lower()] = dish
        index.setdefault(dish.name.strip().lower(), dish)
    return index, dishes


def _suggest(item: str, dishes: list) -> dict | None:
    target = item.strip().lower()
    best, best_score = None, 0.0
    for dish in dishes:
        score = SequenceMatcher(None, target, dish.name.strip().lower()).ratio()
        if score > best_score:
            best, best_score = dish, score
    if best is None or best_score < 0.6:
        return None
    return {"dish": best.id, "dish_name": best.name, "score": round(best_score, 3)}


def match_rows(business, rows) -> dict:
    """Group parsed rows by (dish, date) and report what matched.

    `pos_alias` is tried first, then an exact name match — both exact, because a fuzzy *automatic*
    match would quietly attribute one dish's plates to another and corrupt every variance figure. Fuzzy
    matching only ever produces a *suggestion* a human confirms.
    """
    index, dishes = _index_dishes(business)

    matched: dict[tuple[int, object], dict] = defaultdict(
        lambda: {"plates": 0, "revenue": d(0), "rows": 0}
    )
    unmatched: dict[str, dict] = {}
    dates = set()

    for row in rows:
        dates.add(row.date)
        dish = index.get(row.item.strip().lower())
        if dish is None:
            entry = unmatched.setdefault(
                row.item,
                {
                    "item": row.item,
                    "plates": 0,
                    "revenue": d(0),
                    "rows": 0,
                    "suggestion": _suggest(row.item, dishes),
                },
            )
            entry["plates"] += row.quantity
            entry["revenue"] += d(row.amount)
            entry["rows"] += 1
            continue

        key = (dish.id, row.date)
        bucket = matched[key]
        bucket["plates"] += row.quantity
        bucket["revenue"] += d(row.amount)
        bucket["rows"] += 1
        bucket["dish"] = dish.id
        bucket["dish_name"] = dish.name
        bucket["date"] = row.date

    # A manual figure is somebody's considered entry; an import must not overwrite it (§5c).
    manual = {
        (sale.dish_id, sale.date)
        for sale in Sale.objects.filter(
            business=business, source=SaleSource.MANUAL, date__in=dates or [timezone.localdate()]
        )
    }

    matched_list, blocked = [], []
    for key, bucket in matched.items():
        bucket = dict(bucket)
        bucket["revenue"] = d(bucket["revenue"])
        if key in manual:
            blocked.append(bucket)
        else:
            matched_list.append(bucket)

    matched_list.sort(key=lambda b: (b["date"], b["dish_name"]))
    blocked.sort(key=lambda b: (b["date"], b["dish_name"]))

    return {
        "date_from": min(dates) if dates else None,
        "date_to": max(dates) if dates else None,
        "matched": matched_list,
        "blocked_by_manual": blocked,
        "unmatched": sorted(unmatched.values(), key=lambda e: -e["plates"]),
    }


@transaction.atomic
def confirm_import(access, filename: str, result: dict, aliases: dict | None = None) -> SalesImport:
    """Write the matched rows, replacing only previously *imported* rows in the same range."""
    business = access.business
    date_from, date_to = result["date_from"], result["date_to"]

    if aliases:
        for item, dish_id in aliases.items():
            dish = Dish.objects.filter(pk=dish_id, business=business).first()
            if dish is not None:
                dish.pos_alias = item
                dish.save(update_fields=["pos_alias", "updated_at"])

    batch = SalesImport.objects.create(
        business=business,
        uploaded_by=access.user,
        filename=filename[:200],
        date_from=date_from,
        date_to=date_to,
        rows_total=len(result["matched"])
        + len(result["unmatched"])
        + len(result["blocked_by_manual"]),
        rows_matched=len(result["matched"]),
        rows_unmatched=len(result["unmatched"]),
    )

    replaced = Sale.objects.filter(
        business=business, source=SaleSource.IMPORT, date__gte=date_from, date__lte=date_to
    )
    replaced_count = replaced.count()
    replaced.delete()

    created = [
        Sale(
            business=business,
            date=bucket["date"],
            dish_id=bucket["dish"],
            plates=bucket["plates"],
            revenue=d(bucket["revenue"]),
            entered_by=access.user,
            entered_at=timezone.now(),
            source=SaleSource.IMPORT,
            import_batch=batch,
        )
        for bucket in result["matched"]
    ]
    Sale.objects.bulk_create(created)

    log(
        access,
        "sales.import",
        summary=f"Imported {len(created)} sales row(s) from {filename} "
        f"({date_from} to {date_to}); replaced {replaced_count} previously imported row(s)",
        detail={
            "filename": filename,
            "date_from": str(date_from),
            "date_to": str(date_to),
            "created": len(created),
            "replaced": replaced_count,
            "unmatched": [entry["item"] for entry in result["unmatched"]],
            "blocked_by_manual": [
                {"dish": b["dish_name"], "date": str(b["date"])}
                for b in result["blocked_by_manual"]
            ],
        },
    )
    return batch
