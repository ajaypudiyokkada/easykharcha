"""Generic CSV / Excel: date, item, quantity, amount.

The fallback for any POS that can export four columns, and the format a restaurant can always reach by
editing a spreadsheet by hand.
"""

from __future__ import annotations

import datetime
from decimal import Decimal, InvalidOperation

from django.utils.dateparse import parse_date

from imports.parsers.base import (
    ExcludedRow,
    ParsedRow,
    ParseResult,
    SalesParser,
    business_date,
    normalise_header,
)

#: Accepted spellings per logical column, normalised. First match wins.
ALIASES = {
    "date": ["date", "order date", "bill date", "invoice date", "txn date", "business date"],
    "item": ["item", "item name", "product", "product name", "dish", "name", "description"],
    "quantity": ["quantity", "qty", "qty sold", "plates", "count", "units"],
    "amount": ["amount", "total", "net amount", "net sales", "revenue", "value", "gross amount"],
}

#: Tried in order. Formats carrying a clock time come first so "2026-03-10 23:40" is read as a
#: timestamp rather than falling through to a date-only pattern.
DATE_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M",
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%m/%d/%Y",
    "%d %b %Y",
    "%d-%b-%Y",
    "%d/%m/%y",
)


class GenericParser(SalesParser):
    key = "generic"
    label = "Generic CSV / Excel (date, item, quantity, amount)"
    hint = "Any spreadsheet with a date, an item name, a quantity and an amount."
    accepted_extensions = (".csv", ".txt", ".xlsx", ".xlsm")
    required_headers = ("date", "item", "quantity")

    def find_header(self, table):
        required = ("date", "item", "quantity")
        for index, row in enumerate(table[:25]):
            mapping = self._map(row)
            if all(key in mapping for key in required):
                return index
        return None

    def _map(self, row) -> dict[str, int]:
        present = {}
        for index, cell in enumerate(row):
            present.setdefault(normalise_header(cell), index)
        mapping = {}
        for logical, aliases in ALIASES.items():
            for alias in aliases:
                if alias in present:
                    mapping[logical] = present[alias]
                    break
        return mapping

    def fingerprint(self, table) -> float:
        index = self.find_header(table)
        if index is None:
            return 0.0
        mapping = self._map(table[index])
        # Deliberately below any vendor parser's perfect score: generic is the fallback, so a file a
        # vendor parser recognises should win auto-detect even though generic could also read it.
        return 0.55 + (0.1 if "amount" in mapping else 0.0)

    def parse(self, table, *, cutoff_hour: int = 4) -> ParseResult:
        header_index = self.find_header(table)
        if header_index is None:
            self.require_headers(table, None)
        mapping = self._map(table[header_index])
        missing = [key for key in ("date", "item", "quantity") if key not in mapping]
        if missing:
            self.require_headers(table, None)

        result = ParseResult(format_key=self.key, format_label=self.label)

        for offset, row in enumerate(table[header_index + 1 :], start=header_index + 2):
            if not any(cell not in (None, "") for cell in row):
                continue
            item = str(_cell(row, mapping, "item") or "").strip()
            if not item:
                continue

            raw_date = _cell(row, mapping, "date")
            when = _coerce_date(raw_date)
            if when is None:
                result.excluded.append(ExcludedRow(offset, item, f"unreadable date: {raw_date!r}"))
                continue

            qty = _decimal(_cell(row, mapping, "quantity"))
            if qty <= 0:
                result.excluded.append(ExcludedRow(offset, item, "quantity is zero or negative"))
                continue

            result.rows.append(
                ParsedRow(
                    business_date=business_date(when, cutoff_hour),
                    item_name=item,
                    qty=qty,
                    amount=_decimal(_cell(row, mapping, "amount")),
                    source_row=offset,
                )
            )

        if "amount" not in mapping:
            result.warnings.append(
                "No amount column found, so every line imports at ₹0. Revenue will be wrong until "
                "you add one or edit the sales afterwards."
            )
        return result


def _cell(row, mapping, key):
    index = mapping.get(key)
    if index is None or index >= len(row):
        return None
    return row[index]


def _decimal(value) -> Decimal:
    if value is None or str(value).strip() == "":
        return Decimal("0")
    text = str(value).replace(",", "").replace("₹", "").strip()
    try:
        return Decimal(text)
    except InvalidOperation:
        return Decimal("0")


def _coerce_date(value):
    """Return a `datetime` only when the source actually carried a clock time, else a `date`.

    This distinction drives the business-day cutoff. A column holding "10/03/2026" with no time is
    already a business date — shifting it back by the cutoff would silently move every row in a
    date-only export to the previous day.
    """
    if isinstance(value, datetime.datetime):
        # openpyxl gives midnight for a date-only cell; treat that as a date, not 00:00.
        return value.date() if value.time() == datetime.time(0, 0) else value
    if isinstance(value, datetime.date):
        return value

    text = str(value or "").strip()
    if not text:
        return None
    for fmt in DATE_FORMATS:
        try:
            parsed = datetime.datetime.strptime(text, fmt)
        except ValueError:
            continue
        has_time = any(token in fmt for token in ("%H", "%I"))
        return parsed if has_time else parsed.date()
    return parse_date(text[:10])
