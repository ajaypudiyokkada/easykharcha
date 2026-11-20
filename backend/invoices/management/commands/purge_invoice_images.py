from django.core.management.base import BaseCommand

from invoices.purge import purge_expired_images


class Command(BaseCommand):
    help = (
        "Deletes stored invoice images past INVOICE_IMAGE_RETENTION_DAYS (from upload date, current "
        "setting; the row is kept with removed_at set) and unattached proofs older than "
        "INVOICE_PROOF_UNATTACHED_HOURS. Run daily by the run_ai_jobs worker."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run", action="store_true", help="Count what would be deleted; change nothing."
        )

    def handle(self, *args, **options):
        summary = purge_expired_images(dry_run=options["dry_run"])
        prefix = "Would delete" if summary["dry_run"] else "Deleted"
        self.stdout.write(
            f"{prefix}: {summary['expired']} expired image(s), "
            f"{summary['unattached']} unattached proof(s)."
            + (
                ""
                if summary["dry_run"]
                else f" Files removed {summary['files_deleted']}, already missing "
                f"{summary['files_missing']}."
            )
        )
