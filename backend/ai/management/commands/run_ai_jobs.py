"""The ai/ worker service (docker-compose.prod.yml's `worker`) — polls for queued MenuScan and,
Step EK-4a, EkSetupRun rows and processes them one at a time, so reading a menu (or running EK
setup) never blocks a gunicorn web worker. Dev-only when AI_FAKE is true: the view itself processes
a job inline then, so nothing needs this running — see ai/views.py's MenuScanCreateView/
EkSetupView."""

import logging
import time

from django.core.management.base import BaseCommand
from django.utils import timezone

from ai.files import sweep_old_temp_files
from ai.jobs import process_ek_setup_run, process_menu_scan
from ai.models import EkSetupRun, EkSetupRunStatus, MenuScan, MenuScanStatus

logger = logging.getLogger(__name__)

POLL_SECONDS = 2
HEARTBEAT_SECONDS = 300
STUCK_JOB_TIMEOUT_SECONDS = 600


class Command(BaseCommand):
    help = "Polls for queued MenuScan/EkSetupRun rows and processes them one at a time."

    def handle(self, *args, **options):
        # A prior run that crashed mid-job leaves rows stuck in "reading"/"running" — requeue them
        # instead of leaving them stuck until the timeout below (which only fires while this loop
        # is up).
        requeued_scans = MenuScan.objects.filter(status=MenuScanStatus.READING).update(
            status=MenuScanStatus.QUEUED
        )
        requeued_runs = EkSetupRun.objects.filter(status=EkSetupRunStatus.RUNNING).update(
            status=EkSetupRunStatus.QUEUED
        )
        self.stdout.write(
            f"AI job runner started (requeued {requeued_scans} stuck scan(s), "
            f"{requeued_runs} stuck EK setup run(s))."
        )
        last_heartbeat = timezone.now()

        while True:
            self._fail_stuck_jobs()
            scan = (
                MenuScan.objects.filter(status=MenuScanStatus.QUEUED).order_by("created_at").first()
            )
            run = (
                EkSetupRun.objects.filter(status=EkSetupRunStatus.QUEUED)
                .order_by("created_at")
                .first()
                if scan is None
                else None
            )
            if scan:
                self._process_scan(scan)
                last_heartbeat = timezone.now()
            elif run:
                self._process_ek_setup(run)
                last_heartbeat = timezone.now()
            elif timezone.now() - last_heartbeat >= timezone.timedelta(seconds=HEARTBEAT_SECONDS):
                self.stdout.write("AI job runner heartbeat: waiting for jobs.")
                last_heartbeat = timezone.now()
            sweep_old_temp_files()
            time.sleep(POLL_SECONDS)

    def _process_scan(self, scan: MenuScan) -> None:
        self.stdout.write(f"Processing menu scan {scan.id} (business {scan.business_id})")
        try:
            process_menu_scan(scan.id)
        except Exception as exc:  # noqa: BLE001 - a bug here must never kill the job loop
            logger.exception("Menu scan %s raised an unhandled error", scan.id)
            # Only flips it if process_menu_scan itself didn't already resolve the row (e.g. the
            # crash happened after it had already saved done/failed) — avoids clobbering that result.
            MenuScan.objects.filter(id=scan.id, status=MenuScanStatus.READING).update(
                status=MenuScanStatus.FAILED,
                error_code="worker_error",
                finished_at=timezone.now(),
            )
            self.stdout.write(f"Menu scan {scan.id} failed: {exc}")
            return
        scan.refresh_from_db(fields=["status"])
        self.stdout.write(f"Menu scan {scan.id} finished: {scan.status}")

    def _process_ek_setup(self, run: EkSetupRun) -> None:
        self.stdout.write(f"Processing EK setup run {run.id} (business {run.business_id})")
        try:
            process_ek_setup_run(run.id)
        except Exception as exc:  # noqa: BLE001 - a bug here must never kill the job loop
            logger.exception("EK setup run %s raised an unhandled error", run.id)
            EkSetupRun.objects.filter(id=run.id, status=EkSetupRunStatus.RUNNING).update(
                status=EkSetupRunStatus.FAILED,
                error="worker_error",
                error_detail=f"{type(exc).__name__}: {str(exc)[:500]}",
                finished_at=timezone.now(),
            )
            self.stdout.write(f"EK setup run {run.id} failed: {exc}")
            return
        run.refresh_from_db(fields=["status"])
        self.stdout.write(f"EK setup run {run.id} finished: {run.status}")

    def _fail_stuck_jobs(self) -> None:
        cutoff = timezone.now() - timezone.timedelta(seconds=STUCK_JOB_TIMEOUT_SECONDS)
        stuck_scans = MenuScan.objects.filter(status=MenuScanStatus.READING, started_at__lt=cutoff)
        for scan in stuck_scans:
            scan.status = MenuScanStatus.FAILED
            scan.error_code = "timeout"
            scan.finished_at = timezone.now()
            scan.save(update_fields=["status", "error_code", "finished_at"])

        stuck_runs = EkSetupRun.objects.filter(
            status=EkSetupRunStatus.RUNNING, heartbeat__lt=cutoff
        )
        for run in stuck_runs:
            run.status = EkSetupRunStatus.FAILED
            run.error = "timeout"
            run.finished_at = timezone.now()
            run.save(update_fields=["status", "error", "finished_at"])
