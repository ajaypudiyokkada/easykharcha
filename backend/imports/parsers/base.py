"""The parser contract.

Adding a POS is one subclass + one fixture + one test. Everything downstream — matching, preview,
reconciliation, confirm — works on `ParseResult` and knows nothing about any particular vendor.

Two rules every parser must honour:

1. **Fail loudly on a shape you don't recognise.** Name the missing headers. A parser that guesses
   column positions will silently attribute one dish's plates to another, and the variance report —
   the whole point of this product — then accuses an honest kitchen of theft.
2. **Never return a customer column.** Real exports carry name, phone and address
   (`docs/imports/petpooja_orders_master.md` §8). `ParsedRow` has nowhere to put them, deliberately.
"""

from __future__ import annotations

import datetime
import re
from dataclasses import dataclass, field
from decimal import Decimal

from core.exceptions import BusinessRuleError
from core.fields import ZERO, d


@dataclass
class ParsedRow:
    """One normalised item line. The only shape the rest of the importer sees."""

    business_date: datetime.date
    item_name: str
    qty: Decimal
    #: Net of discount, excluding tax and all charges — see the profile doc §7.
    amount: Decimal
    source_row: int
    channel: str = ""


@dataclass
class ExcludedRow:
    source_row: int
    item_name: str
    reason: str


@dataclass
class ParseResult:
    rows: list[ParsedRow] = field(default_factory=list)
    excluded: list[ExcludedRow] = field(default_factory=list)
    #: What the file itself claims, when it carries a totals row. None when it does not.
    file_total: Decimal | None = None
    warnings: list[str] = field(default_factory=list)
    format_key: str = ""
    format_label: str = ""

    @property
    def parsed_total(self) -> Decimal:
        return sum((row.amount for row in self.rows), ZERO)

    @property
    def date_from(self) -> datetime.date | None:
        return min((row.business_date for row in self.rows), default=None)

    @property
    def date_to(self) -> datetime.date | None:
        return max((row.business_date for row in self.rows), default=None)

    def reconciliation(self) -> dict:
        """Parsed total vs the file's own total.

        Surfaced even when it ties, because "we checked and it matches" is the reassurance that makes
        an owner trust the number. `difference` of None means the file gave us nothing to check against.
        """
        parsed = self.parsed_total
        if self.file_total is None:
            return {
                "parsed_total": parsed,
                "file_total": None,
                "difference": None,
                "matches": None,
                "message": "This file carries no total of its own, so there is nothing to check against.",
            }
        difference = parsed - d(self.file_total)
        matches = abs(difference) <= Decimal("1")
        return {
            "parsed_total": parsed,
            "file_total": d(self.file_total),
            "difference": difference,
            "matches": matches,
            "message": (
                "Parsed total matches the file's own total."
                if matches
                else f"Parsed ₹{parsed} but the file says ₹{d(self.file_total)} "
                f"(difference ₹{difference}). Check the excluded rows before importing."
            ),
        }

    def excluded_by_reason(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for row in self.excluded:
            counts[row.reason] = counts.get(row.reason, 0) + 1
        return counts


def normalise_header(value) -> str:
    """Case, spacing and punctuation insensitive, so a reordered or re-punctuated export still maps."""
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalise_item(value) -> str:
    """Item-name key for matching. Collapses case, spacing and punctuation but keeps the words."""
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


class SalesParser:
    key: str = ""
    label: str = ""
    hint: str = ""
    accepted_extensions: tuple[str, ...] = (".csv", ".xlsx")
    #: Headers that must all be present for this parser to claim the file.
    required_headers: tuple[str, ...] = ()

    def fingerprint(self, table: list[list]) -> float:
        """0–1 confidence that this parser understands the file.

        Based on the header signature, never the file name: restaurants rename downloads, and a file
        called `petpooja.xlsx` is not evidence of anything.
        """
        header_index = self.find_header(table)
        if header_index is None:
            return 0.0
        present = {normalise_header(cell) for cell in table[header_index]}
        required = {normalise_header(h) for h in self.required_headers}
        if not required:
            return 0.0
        return len(required & present) / len(required)

    def find_header(self, table: list[list]) -> int | None:
        """Locate the header row by signature.

        Real exports put a title block above the header — Petpooja uses three rows plus two blanks —
        so row 0 is not the header and assuming it is reads the title as column names.
        """
        required = {normalise_header(h) for h in self.required_headers}
        if not required:
            return None
        best, best_score = None, 0.0
        for index, row in enumerate(table[:25]):
            present = {normalise_header(cell) for cell in row}
            score = len(required & present) / len(required)
            if score > best_score:
                best, best_score = index, score
        return best if best_score >= 0.6 else None

    def require_headers(self, table: list[list], header_index: int | None) -> dict[str, int]:
        if header_index is None:
            raise BusinessRuleError(
                f"This does not look like a {self.label} file — none of its rows carry the expected "
                f"column headings ({', '.join(self.required_headers)}).",
                code="header_not_found",
                detail={"expected": list(self.required_headers)},
            )
        mapping = {}
        found = {}
        for index, cell in enumerate(table[header_index]):
            found.setdefault(normalise_header(cell), index)
        missing = []
        for header in self.required_headers:
            key = normalise_header(header)
            if key in found:
                mapping[header] = found[key]
            else:
                missing.append(header)
        if missing:
            raise BusinessRuleError(
                "This file is missing columns the importer needs: "
                + ", ".join(missing)
                + ". Found: "
                + ", ".join(str(c) for c in table[header_index] if c)
                + ".",
                code="missing_columns",
                detail={"missing": missing},
            )
        return mapping

    def parse(self, table: list[list], *, cutoff_hour: int = 4) -> ParseResult:
        raise NotImplementedError


def business_date(when: datetime.datetime | datetime.date, cutoff_hour: int) -> datetime.date:
    """An order before the cutoff belongs to the previous business day.

    A 1 a.m. order is the tail of last night's service, and the stock that made it was counted in
    yesterday's closing. Filing it under today would show up as unexplained loss.
    """
    if isinstance(when, datetime.datetime):
        return (when - datetime.timedelta(hours=cutoff_hour)).date()
    return when
