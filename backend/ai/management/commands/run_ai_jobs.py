"""The ai/ worker service (docker-compose.prod.yml's `worker`) — polls for queued MenuScan rows and
processes them one at a time, so reading a menu never blocks a gunicorn web worker. Dev-only when
AI_FAKE is true: the view itself processes a scan inline then, so nothing needs this running — see
ai/views.py's MenuScanCreateView."""

import time

from django.core.management.base import BaseCommand
from django.utils import timezone

from ai.files import sweep_old_temp_files
from ai.jobs import process_menu_scan
from ai.models import MenuScan, MenuScanStatus

POLL_SECONDS = 2
STUCK_JOB_TIMEOUT_SECONDS = 120


class Command(BaseCommand):
    help = "Polls for queued MenuScan rows and processes them one at a time."

    def handle(self, *args, **options):
        # A prior run that crashed mid-job leaves rows stuck in "reading" — requeue them instead of
        # leaving them stuck until the 120s timeout below (which only fires while this loop is up).
        requeued = MenuScan.objects.filter(status=MenuScanStatus.READING).update(
            status=MenuScanStatus.QUEUED
        )
        self.stdout.write(f"AI job worker started (requeued {requeued} stuck job(s)).")

        while True:
            self._fail_stuck_jobs()
            scan = (
                MenuScan.objects.filter(status=MenuScanStatus.QUEUED).order_by("created_at").first()
            )
            if scan:
                self.stdout.write(f"Processing menu scan {scan.id} (business {scan.business_id})")
                process_menu_scan(scan.id)
            sweep_old_temp_files()
            time.sleep(POLL_SECONDS)

    def _fail_stuck_jobs(self) -> None:
        cutoff = timezone.now() - timezone.timedelta(seconds=STUCK_JOB_TIMEOUT_SECONDS)
        stuck = MenuScan.objects.filter(status=MenuScanStatus.READING, started_at__lt=cutoff)
        for scan in stuck:
            scan.status = MenuScanStatus.FAILED
            scan.error_code = "timeout"
            scan.finished_at = timezone.now()
            scan.save(update_fields=["status", "error_code", "finished_at"])
