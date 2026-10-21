import csv
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from geo.models import Pincode

DATA_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "pincodes_in.csv"
BATCH_SIZE = 5000


class Command(BaseCommand):
    help = "Loads backend/geo/data/pincodes_in.csv into the Pincode table, replacing its contents."

    def add_arguments(self, parser):
        parser.add_argument(
            "--if-empty",
            action="store_true",
            help="Skip the load if the table already has rows (used on container start).",
        )

    def handle(self, *args, **options):
        if options["if_empty"] and Pincode.objects.exists():
            self.stdout.write("Pincode table already has data — skipping load.")
            return

        with DATA_PATH.open(newline="", encoding="utf-8") as data_file:
            rows = [
                Pincode(
                    pincode=row["pincode"],
                    area=row["area"],
                    district=row["district"],
                    state=row["state"],
                    office_type=row["office_type"],
                )
                for row in csv.DictReader(data_file)
            ]

        # Delete + bulk_create in one transaction so a failed load never leaves the table half
        # replaced — a concurrent request mid-load either sees the old full table or the new one.
        with transaction.atomic():
            Pincode.objects.all().delete()
            Pincode.objects.bulk_create(rows, batch_size=BATCH_SIZE)

        unique_pincodes = len({row.pincode for row in rows})
        self.stdout.write(
            self.style.SUCCESS(f"Loaded {len(rows)} rows, {unique_pincodes} unique pincodes.")
        )
