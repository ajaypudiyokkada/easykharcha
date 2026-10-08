"""Load the global recipe-template library from CSV.

Only owner-stated rows ship (docs/DECISIONS.md O-3). A made-up gram table would produce false variance
alerts on day one and teach the owner to ignore the report — which is the one failure this product
cannot recover from. Add rows to `recipes/data/templates.csv` as a chef validates them.

Columns: code,name,cuisine,category,portion_label,pieces_per_portion,canonical,qty_per_portion,unit,
basis,confidence — one row per *line*; rows sharing a `code` build one template.
"""

import csv
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from recipes.models import CanonicalIngredient, RecipeTemplate, RecipeTemplateLine, TemplateBasis

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "templates.csv"


class Command(BaseCommand):
    help = "Load global recipe templates from a CSV."

    def add_arguments(self, parser):
        parser.add_argument("--path", default=str(DEFAULT_PATH))
        parser.add_argument(
            "--create-canonicals",
            action="store_true",
            help="Create any canonical ingredient referenced but not yet defined.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        path = Path(options["path"])
        if not path.exists():
            raise CommandError(f"No such file: {path}")

        templates: dict[str, dict] = {}
        with path.open(newline="", encoding="utf-8-sig") as handle:
            for line_number, row in enumerate(csv.DictReader(handle), start=2):
                code = (row.get("code") or "").strip()
                if not code:
                    continue
                entry = templates.setdefault(
                    code,
                    {
                        "name": (row.get("name") or "").strip(),
                        "cuisine": (row.get("cuisine") or "").strip(),
                        "category": (row.get("category") or "").strip(),
                        "portion_label": (row.get("portion_label") or "").strip(),
                        "pieces_per_portion": _decimal_or_none(row.get("pieces_per_portion")),
                        "lines": [],
                    },
                )
                canonical_code = (row.get("canonical") or "").strip()
                if not canonical_code:
                    raise CommandError(f"Row {line_number}: missing canonical.")
                entry["lines"].append(
                    {
                        "canonical": canonical_code,
                        "qty_per_portion": Decimal(str(row["qty_per_portion"]).strip()),
                        "unit": (row.get("unit") or "g").strip(),
                        "basis": (row.get("basis") or TemplateBasis.WEIGHT).strip(),
                        "confidence": (row.get("confidence") or "typical").strip(),
                        "line_number": line_number,
                    }
                )

        created_templates = created_lines = 0
        for code, entry in templates.items():
            template, _ = RecipeTemplate.objects.update_or_create(
                code=code,
                defaults={
                    "name": entry["name"],
                    "cuisine": entry["cuisine"],
                    "category": entry["category"],
                    "portion_label": entry["portion_label"],
                    "pieces_per_portion": entry["pieces_per_portion"],
                },
            )
            created_templates += 1
            for line in entry["lines"]:
                canonical = CanonicalIngredient.objects.filter(code=line["canonical"]).first()
                if canonical is None:
                    if not options["create_canonicals"]:
                        raise CommandError(
                            f"Row {line['line_number']}: canonical '{line['canonical']}' does not "
                            "exist. Run with --create-canonicals, or seed it first."
                        )
                    canonical = CanonicalIngredient.objects.create(
                        code=line["canonical"], name=line["canonical"].replace("_", " ").title()
                    )
                RecipeTemplateLine.objects.update_or_create(
                    template=template,
                    canonical=canonical,
                    defaults={
                        "qty_per_portion": line["qty_per_portion"],
                        "unit": line["unit"],
                        "basis": line["basis"],
                        "confidence": line["confidence"],
                    },
                )
                created_lines += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Loaded {created_templates} template(s) and {created_lines} line(s) from {path.name}."
            )
        )
        self.stdout.write(
            "Only owner-stated values are seeded. Grams for other dishes must be authored and "
            "validated before release — see docs/DECISIONS.md O-3."
        )


def _decimal_or_none(value):
    text = (value or "").strip()
    return Decimal(text) if text else None
