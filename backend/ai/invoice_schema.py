"""What one imported customer bill is allowed to look like after the model has read it (Step S4a).

Deliberately NOT here: the customer's name, phone or address, and the restaurant's own GSTIN/FSSAI.
The model is told to ignore them, and because every model below drops unknown keys, anything it
returns anyway never reaches the stored draft. The model reads exactly what is printed; this module
only cleans formats (numbers, dates). No total, tax or amount is ever worked out here: AI never does
the maths."""

import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_LINES = 100
_NUMBER_JUNK = re.compile(r"[^\d.\-+]")
_MONTHS = {
    name: index
    for index, names in enumerate(
        [
            ("jan", "january"),
            ("feb", "february"),
            ("mar", "march"),
            ("apr", "april"),
            ("may",),
            ("jun", "june"),
            ("jul", "july"),
            ("aug", "august"),
            ("sep", "sept", "september"),
            ("oct", "october"),
            ("nov", "november"),
            ("dec", "december"),
        ],
        start=1,
    )
    for name in names
}

Reason = Literal["", "blurred", "cropped", "not_a_bill", "nothing_found"]
PaymentModeRead = Literal["cash", "upi", "card", "bank_transfer", "other"]


def parse_number(value) -> str | None:
    """'₹1,110', '5No', ' 380.00 ', 380 -> a plain decimal string; None when there's no number.
    Quantity suffixes like "5No" or "2 Pcs" are dropped; a bare '-' or text gives None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int | float | Decimal):
        text = str(value)
    else:
        text = _NUMBER_JUNK.sub("", str(value).replace(",", ""))
    if not text or text in {"-", "+", "."}:
        return None
    try:
        number = Decimal(text)
    except InvalidOperation:
        return None
    if not number.is_finite():
        return None
    return (
        format(number.normalize(), "f") if number == number.to_integral() else format(number, "f")
    )


def parse_bill_date(text: str | None) -> date | None:
    """India is day-first. Handles '19/11/26', '11-10-2026', '16.05.2024', '16 May 2024',
    '16-May-24', 'May 16, 2024'. Returns None when nothing sensible can be read."""
    if not text:
        return None
    cleaned = re.sub(r"\b(date|dt)\b\s*[:.\-]?", "", str(text), flags=re.I).strip()
    numeric = re.search(r"(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2}|\d{4})\b", cleaned)
    if numeric:
        day, month, year = (int(g) for g in numeric.groups())
        return _safe_date(year if year > 99 else 2000 + year, month, day)
    named = re.search(
        r"(\d{1,2})(?:st|nd|rd|th)?[\s\-/,.]*([A-Za-z]{3,9})[\s\-/,.]*(\d{2}|\d{4})\b", cleaned
    )
    if named and named.group(2).lower() in _MONTHS:
        year = int(named.group(3))
        return _safe_date(
            year if year > 99 else 2000 + year, _MONTHS[named.group(2).lower()], int(named.group(1))
        )
    month_first = re.search(
        r"([A-Za-z]{3,9})[\s\-/,.]*(\d{1,2})(?:st|nd|rd|th)?[\s\-/,.]*(\d{2}|\d{4})\b", cleaned
    )
    if month_first and month_first.group(1).lower() in _MONTHS:
        year = int(month_first.group(3))
        return _safe_date(
            year if year > 99 else 2000 + year,
            _MONTHS[month_first.group(1).lower()],
            int(month_first.group(2)),
        )
    return None


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _clean_text(value, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _clamp(value) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


class _Base(BaseModel):
    # Unknown keys (a model volunteering "customer_name", say) are dropped, never kept.
    model_config = ConfigDict(extra="ignore")


class Readability(_Base):
    ok: bool = True
    reason: Reason = ""

    @field_validator("reason", mode="before")
    @classmethod
    def _reason(cls, value):
        return value if value in ("blurred", "cropped", "not_a_bill", "nothing_found") else ""


class BillLine(_Base):
    name_as_printed: str
    qty: str | None = None
    unit_rate: str | None = None
    amount: str | None = None
    # None = the model gave no score for this line (unknown, not low).
    confidence: float | None = None

    @field_validator("name_as_printed", mode="before")
    @classmethod
    def _name(cls, value):
        return _clean_text(value, 120)

    @field_validator("qty", "unit_rate", "amount", mode="before")
    @classmethod
    def _numbers(cls, value):
        return parse_number(value)

    @field_validator("confidence", mode="before")
    @classmethod
    def _confidence(cls, value):
        return None if value is None else _clamp(value)


class Charge(_Base):
    """A discount, tax or similar line exactly as printed: label plus signed amount (a discount is
    negative)."""

    label: str
    amount: str | None = None

    @field_validator("label", mode="before")
    @classmethod
    def _label(cls, value):
        return _clean_text(value, 60)

    @field_validator("amount", mode="before")
    @classmethod
    def _amount(cls, value):
        return parse_number(value)


class InvoiceExtractionResult(_Base):
    readability: Readability = Field(default_factory=Readability)
    bill_number: str | None = None
    bill_date_printed: str | None = None
    bill_date: str | None = None
    bill_time: str | None = None
    lines: list[BillLine] = Field(default_factory=list)
    items_total: str | None = None
    discounts: list[Charge] = Field(default_factory=list)
    taxes: list[Charge] = Field(default_factory=list)
    round_off: str | None = None
    grand_total: str | None = None
    payment_mode: PaymentModeRead | None = None
    is_reprint: bool = False
    confidence: dict[str, float] = Field(default_factory=dict)

    @field_validator("bill_number", "bill_time", "bill_date_printed", mode="before")
    @classmethod
    def _short_text(cls, value):
        text = _clean_text(value, 40)
        return text or None

    @field_validator("items_total", "round_off", "grand_total", mode="before")
    @classmethod
    def _numbers(cls, value):
        return parse_number(value)

    @field_validator("payment_mode", mode="before")
    @classmethod
    def _mode(cls, value):
        return value if value in ("cash", "upi", "card", "bank_transfer", "other") else None

    @field_validator("confidence", mode="before")
    @classmethod
    def _confidences(cls, value):
        if not isinstance(value, dict):
            return {}
        return {_clean_text(k, 30): _clamp(v) for k, v in list(value.items())[:20]}

    def sanitized(self) -> dict:
        """The draft body: capped lines, no empty-name lines, and the sale date worked out by this
        server from the printed text (day-first), falling back to the model's own ISO date. Never
        invents a value that wasn't read."""
        data = self.model_dump()
        data["lines"] = [line for line in data["lines"][:MAX_LINES] if line["name_as_printed"]]
        parsed = parse_bill_date(self.bill_date_printed) or _iso_or_none(self.bill_date)
        data["bill_date"] = parsed.isoformat() if parsed else None
        return data


def _iso_or_none(text: str | None) -> date | None:
    if not text:
        return None
    try:
        return date.fromisoformat(str(text).strip()[:10])
    except ValueError:
        return parse_bill_date(text)


class LineMatch(_Base):
    line_id: str
    sell_item_id: int | None = None
    confidence: float = 0.0

    @field_validator("line_id", mode="before")
    @classmethod
    def _line_id(cls, value):
        return _clean_text(value, 20)

    @field_validator("sell_item_id", mode="before")
    @classmethod
    def _item_id(cls, value):
        if isinstance(value, bool):
            return None
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    @field_validator("confidence", mode="before")
    @classmethod
    def _confidence(cls, value):
        return _clamp(value)


class BillMatchResult(_Base):
    matches: list[LineMatch] = Field(default_factory=list)

    def sanitized(self, valid_item_ids: set[int], line_ids: set[str]) -> dict:
        """One answer per known bill line, and an item id that is not in the owner's own list is
        dropped to null: the model can never introduce an item that doesn't exist."""
        by_line: dict[str, dict] = {}
        for match in self.matches:
            if match.line_id not in line_ids or match.line_id in by_line:
                continue
            item_id = match.sell_item_id if match.sell_item_id in valid_item_ids else None
            by_line[match.line_id] = {
                "line_id": match.line_id,
                "sell_item_id": item_id,
                "confidence": match.confidence if item_id is not None else 0.0,
            }
        return {"matches": list(by_line.values())}
