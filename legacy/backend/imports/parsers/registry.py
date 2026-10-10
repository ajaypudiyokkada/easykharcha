"""Format registry, file reading and auto-detect.

Register a parser here and it appears in the Import screen's dropdown, takes part in auto-detect, and
gets a reconciliation line for free.
"""

from __future__ import annotations

import csv
import io

from core.exceptions import BusinessRuleError
from imports.parsers.base import ParseResult, SalesParser
from imports.parsers.generic import GenericParser

#: Order matters: the first registered parser is the recommended one in the UI.
PARSERS: list[SalesParser] = [GenericParser()]


def register(parser: SalesParser) -> None:
    PARSERS.insert(0, parser)


def formats() -> list[dict]:
    return [
        {
            "key": parser.key,
            "label": parser.label,
            "hint": parser.hint,
            "accepted_extensions": list(parser.accepted_extensions),
            "sample_headers": list(parser.required_headers),
        }
        for parser in PARSERS
    ]


def get(key: str) -> SalesParser | None:
    return next((parser for parser in PARSERS if parser.key == key), None)


def read_table(filename: str, data: bytes) -> list[list]:
    """File bytes to a list of rows, without interpreting any of them."""
    lower = filename.lower()
    if lower.endswith((".xlsx", ".xlsm")):
        return _from_xlsx(data)
    if lower.endswith((".csv", ".txt")):
        return _from_csv(data)
    raise BusinessRuleError("Upload a .csv or .xlsx export from your POS.", code="unsupported_file")


def _from_csv(data: bytes) -> list[list]:
    text = data.decode("utf-8-sig", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    return list(csv.reader(io.StringIO(text), dialect))


def _from_xlsx(data: bytes) -> list[list]:
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    sheet = workbook.active
    return [list(row) for row in sheet.iter_rows(values_only=True)]


def detect(table: list[list]) -> tuple[SalesParser | None, float]:
    """Best-matching parser and its confidence."""
    scored = [(parser, parser.fingerprint(table)) for parser in PARSERS]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    best, score = scored[0] if scored else (None, 0.0)
    return (best, score) if score > 0 else (None, 0.0)


def parse(
    filename: str, data: bytes, *, format_key: str = "auto", cutoff_hour: int = 4
) -> ParseResult:
    """Read, detect (or honour an explicit choice), and parse.

    When the user picks a format and detection disagrees confidently, the chosen parser still runs —
    they may know something we don't — but the result carries a warning saying so.
    """
    table = read_table(filename, data)
    table = [row for row in table if row and any(cell not in (None, "") for cell in row)]
    if not table:
        raise BusinessRuleError("That file has no rows.", code="empty_file")

    detected, confidence = detect(table)

    if format_key in ("", "auto", None):
        parser = detected
        if parser is None:
            raise BusinessRuleError(
                "Could not tell what kind of file this is. Pick the format explicitly, or check it is "
                "the sales report and not another export.",
                code="format_not_detected",
            )
    else:
        parser = get(format_key)
        if parser is None:
            raise BusinessRuleError(f"Unknown import format '{format_key}'.", code="unknown_format")

    result = parser.parse(table, cutoff_hour=cutoff_hour)
    result.format_key = parser.key
    result.format_label = parser.label

    if detected is not None and detected.key != parser.key and confidence >= 0.9:
        result.warnings.append(
            f"This looks like a {detected.label} file, but you chose {parser.label}. "
            "Check the preview carefully before confirming."
        )
    return result
