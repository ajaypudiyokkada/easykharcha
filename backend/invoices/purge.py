"""Deleting stored images that are past their time, shared by the `purge_invoice_images` command and
the daily call from the run_ai_jobs worker.

Two rules, both using the CURRENT settings (not the value at upload time):
  * any image older than INVOICE_IMAGE_RETENTION_DAYS (from uploaded_at): file deleted, row kept with
    removed_at set, so an invoice can say "the proof was removed" instead of just losing it;
  * an UNATTACHED image older than INVOICE_PROOF_UNATTACHED_HOURS: file and row deleted (nothing ever
    referenced it);
  * an unconfirmed bill import (Step S4a) older than that: marked abandoned and its draft dropped."""

import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .images import delete_file
from .models import ImportStatus, InvoiceImport, StoredImage

logger = logging.getLogger(__name__)


def purge_expired_images(*, dry_run: bool = False) -> dict:
    now = timezone.now()
    retention_cutoff = now - timedelta(days=settings.INVOICE_IMAGE_RETENTION_DAYS)
    unattached_cutoff = now - timedelta(hours=settings.INVOICE_PROOF_UNATTACHED_HOURS)

    # An import still unconfirmed after the same window is abandoned (its draft dropped); its
    # never-attached photo is then removed by the unattached rule below.
    stale_imports = InvoiceImport.objects.filter(
        status__in=[
            ImportStatus.QUEUED,
            ImportStatus.READING,
            ImportStatus.READY,
            ImportStatus.FAILED,
        ],
        created_at__lt=unattached_cutoff,
    )
    stale_import_count = stale_imports.count()

    unattached = list(
        StoredImage.objects.filter(
            attached=False, removed_at__isnull=True, uploaded_at__lt=unattached_cutoff
        )
    )
    unattached_ids = {image.id for image in unattached}
    expired = [
        image
        for image in StoredImage.objects.filter(
            removed_at__isnull=True, uploaded_at__lt=retention_cutoff
        )
        if image.id not in unattached_ids
    ]

    summary = {
        "dry_run": dry_run,
        "expired": len(expired),
        "unattached": len(unattached),
        "imports_abandoned": stale_import_count,
        "files_deleted": 0,
        "files_missing": 0,
    }
    if dry_run:
        return summary

    for image in expired + unattached:
        if delete_file(image):
            summary["files_deleted"] += 1
        else:
            summary["files_missing"] += 1

    with transaction.atomic():
        stale_imports.update(status=ImportStatus.ABANDONED, abandoned_at=now, draft=None)
        StoredImage.objects.filter(id__in=[i.id for i in expired]).update(removed_at=now)
        StoredImage.objects.filter(id__in=unattached_ids).delete()

    logger.info("purge_invoice_images %s", summary)
    return summary
