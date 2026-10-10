"""Turning a parsed POS file into Sale rows (§5c).

The product's position, worth restating because it shapes this code: we reconcile physical counts
against sales. We do not maintain a perpetual system inventory. An import only ever writes Sale rows —
it never touches stock.

Nothing about the uploaded file survives the request except a hash: no file, no customer column. Real
exports carry name, phone and address (docs/imports/petpooja_orders_master.md §8).
"""

from __future__ import annotations

import hashlib

from django.db import transaction
from django.utils import timezone

from audit.services import log
from core.exceptions import BusinessRuleError
from core.fields import d
from imports import matching
from imports.parsers import ParseResult
from inventory.models import Sale, SalesImport, SaleSource


def content_hash(data: bytes, format_key: str, date_from, date_to) -> str:
    """Identity of one import attempt.

    Confirming twice must not double-count — a manager on bad restaurant wifi will press the button
    again when nothing seems to happen.
    """
    digest = hashlib.sha256()
    digest.update(data)
    digest.update(format_key.encode())
    digest.update(str(date_from).encode())
    digest.update(str(date_to).encode())
    return digest.hexdigest()


def build_preview(business, result: ParseResult, *, filename: str) -> dict:
    """Everything the preview screen needs. Writes nothing."""
    outcome = matching.match(business, result.rows)
    matched, unmatched = outcome["matched"], outcome["unmatched"]

    # A manual figure is somebody's considered entry; an import must not overwrite it.
    manual = {
        (sale.dish_id, sale.date)
        for sale in Sale.objects.filter(
            business=business,
            source=SaleSource.MANUAL,
            date__gte=result.date_from or timezone.localdate(),
            date__lte=result.date_to or timezone.localdate(),
        )
    }

    importable, blocked = [], []
    for group in matched:
        payload = {
            "dish": group.dish.id,
            "dish_name": group.dish.name,
            "date": group.business_date,
            "plates": group.plates,
            "revenue": group.revenue,
            "rows": group.source_rows,
            "channel": ", ".join(sorted(group.channels)),
        }
        (blocked if (group.dish.id, group.business_date) in manual else importable).append(payload)

    unmatched_payload = [
        {
            "item": entry.item_name,
            "plates": entry.plates,
            "revenue": entry.revenue,
            "rows": entry.rows,
            "suggestions": entry.suggestions,
        }
        for entry in unmatched
    ]

    return {
        "filename": filename,
        "format": {"key": result.format_key, "label": result.format_label},
        "date_from": result.date_from,
        "date_to": result.date_to,
        "counts": {
            "rows_read": len(result.rows) + len(result.excluded),
            "rows_included": len(result.rows),
            "rows_excluded": len(result.excluded),
            "excluded_by_reason": result.excluded_by_reason(),
            "matched_groups": len(importable),
            "unmatched_items": len(unmatched_payload),
            "blocked_by_manual": len(blocked),
        },
        "excluded": [
            {"row": row.source_row, "item": row.item_name, "reason": row.reason}
            for row in result.excluded[:100]
        ],
        "reconciliation": result.reconciliation(),
        "matched": importable,
        "blocked_by_manual": blocked,
        "unmatched": unmatched_payload,
        # So "skip the unmatched" is an informed choice rather than a shrug.
        "unmatched_impact": {
            "plates": sum((entry.plates for entry in unmatched), d(0)),
            "revenue": sum((entry.revenue for entry in unmatched), d(0)),
        },
        "warnings": result.warnings,
    }


@transaction.atomic
def confirm(access, *, filename: str, result: ParseResult, preview: dict, file_hash: str) -> dict:
    """Write the matched rows, replacing only previously *imported* rows in the same range."""
    business = access.business
    date_from, date_to = result.date_from, result.date_to
    if date_from is None or date_to is None:
        raise BusinessRuleError("No dated rows to import.", code="no_rows")

    existing = SalesImport.objects.filter(business=business, file_hash=file_hash).first()
    if existing is not None:
        # Idempotent by design: the same file, format and range confirmed twice is a no-op, not a
        # second set of sales.
        return {
            "import": existing,
            "created": 0,
            "replaced": 0,
            "already_imported": True,
            "message": (
                f"That exact file was already imported on "
                f"{timezone.localtime(existing.uploaded_at):%d %b %Y at %H:%M}. Nothing was changed."
            ),
        }

    batch = SalesImport.objects.create(
        business=business,
        uploaded_by=access.user,
        filename=filename[:200],
        format_key=result.format_key,
        file_hash=file_hash,
        date_from=date_from,
        date_to=date_to,
        rows_total=preview["counts"]["rows_read"],
        rows_matched=len(preview["matched"]),
        rows_unmatched=len(preview["unmatched"]),
    )

    replaced = Sale.objects.filter(
        business=business, source=SaleSource.IMPORT, date__gte=date_from, date__lte=date_to
    )
    replaced_count = replaced.count()
    replaced.delete()

    now = timezone.now()
    created = [
        Sale(
            business=business,
            date=row["date"],
            dish_id=row["dish"],
            # Plates are whole; a half-plate alias on an odd count rounds rather than failing.
            plates=int(round(float(row["plates"]))),
            revenue=d(row["revenue"]),
            entered_by=access.user,
            entered_at=now,
            source=SaleSource.IMPORT,
            channel=row.get("channel", "")[:40],
            import_batch=batch,
        )
        for row in preview["matched"]
        if int(round(float(row["plates"]))) > 0
    ]
    Sale.objects.bulk_create(created)

    log(
        access,
        "sales.import",
        summary=(
            f"Imported {len(created)} sales row(s) from {filename} "
            f"({date_from} to {date_to}) via {result.format_label}; "
            f"replaced {replaced_count} previously imported row(s)"
        ),
        detail={
            "filename": filename,
            "format": result.format_key,
            "date_from": str(date_from),
            "date_to": str(date_to),
            "created": len(created),
            "replaced": replaced_count,
            "reconciliation": {
                k: str(v) for k, v in result.reconciliation().items() if k != "message"
            },
            "unmatched": [entry["item"] for entry in preview["unmatched"]],
            "blocked_by_manual": [
                {"dish": row["dish_name"], "date": str(row["date"])}
                for row in preview["blocked_by_manual"]
            ],
        },
    )
    return {
        "import": batch,
        "created": len(created),
        "replaced": replaced_count,
        "already_imported": False,
        "message": f"Imported {len(created)} day/dish rows.",
    }
