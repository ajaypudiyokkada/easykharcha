"""The deterministic checks on an imported bill's draft (Step S4b): plain code, no AI, and no tax is
ever recomputed from a percentage; the printed numbers are only added up and compared."""

from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

CENT = Decimal("0.01")
ITEMS_TOLERANCE = Decimal("0.01")
GRAND_TOLERANCE = Decimal("1.00")
OLD_DAYS = 7
LOW_CONFIDENCE = 0.7
_CONFIDENCE_FIELDS = ("bill_date", "bill_number", "items_total", "grand_total")


def _dec(value) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


def _fmt(value: Decimal) -> str:
    return format(value.quantize(CENT), "f")


def _check(code: str, severity: str, data: dict | None = None, line_id: str | None = None) -> dict:
    check = {"code": code, "severity": severity, "data": data or {}}
    if line_id is not None:
        check["line_id"] = line_id
    return check


def compute_checks(draft: dict, today: date) -> list[dict]:
    """Returns the checks for a draft whose lines already carry `line_id` and `match`. Also sets
    `amount_mismatch` on each line's `flags`."""
    checks: list[dict] = []
    lines = draft.get("lines", [])

    # --- date and bill number ---
    raw_date = draft.get("bill_date")
    bill_date = date.fromisoformat(raw_date) if raw_date else None
    if bill_date is None:
        checks.append(_check("DATE_MISSING", "block"))
    elif bill_date > today:
        checks.append(
            _check("DATE_FUTURE", "block", {"bill_date": raw_date, "today": today.isoformat()})
        )
    elif bill_date < today - timedelta(days=OLD_DAYS):
        checks.append(
            _check(
                "DATE_OLD", "warn", {"bill_date": raw_date, "days_old": (today - bill_date).days}
            )
        )
    if not draft.get("bill_number"):
        checks.append(_check("BILL_NUMBER_MISSING", "info"))

    # --- each line: quantity x rate against the printed amount ---
    for line in lines:
        flags = line.setdefault("flags", {})
        flags["amount_mismatch"] = False
        qty, rate, amount = (
            _dec(line.get("qty")),
            _dec(line.get("unit_rate")),
            _dec(line.get("amount")),
        )
        if qty is None or rate is None or amount is None:
            continue
        expected = qty * rate
        if abs(expected - amount) > ITEMS_TOLERANCE:
            flags["amount_mismatch"] = True
            checks.append(
                _check(
                    "LINE_AMOUNT_MISMATCH",
                    "warn",
                    {
                        "qty": line["qty"],
                        "unit_rate": line["unit_rate"],
                        "amount": line["amount"],
                        "expected": _fmt(expected),
                    },
                    line["line_id"],
                )
            )

    # --- totals ---
    amounts = [_dec(line.get("amount")) for line in lines]
    all_amounts = bool(amounts) and all(a is not None for a in amounts)
    sum_of_lines = (
        sum((a for a in amounts if a is not None), start=Decimal("0")) if all_amounts else None
    )
    items_total = _dec(draft.get("items_total"))
    if (
        items_total is not None
        and sum_of_lines is not None
        and abs(sum_of_lines - items_total) > ITEMS_TOLERANCE
    ):
        checks.append(
            _check(
                "TOTAL_MISMATCH",
                "warn",
                {
                    "kind": "items",
                    "sum_of_lines": _fmt(sum_of_lines),
                    "printed": _fmt(items_total),
                    "difference": _fmt(abs(sum_of_lines - items_total)),
                },
            )
        )
    grand = _dec(draft.get("grand_total"))
    base = items_total if items_total is not None else sum_of_lines
    if grand is not None and base is not None:
        discounts = sum(
            (abs(_dec(c.get("amount")) or Decimal("0")) for c in draft.get("discounts", [])),
            start=Decimal("0"),
        )
        taxes = sum(
            (_dec(c.get("amount")) or Decimal("0") for c in draft.get("taxes", [])),
            start=Decimal("0"),
        )
        round_off = _dec(draft.get("round_off")) or Decimal("0")
        computed = base - discounts + taxes + round_off
        if abs(computed - grand) > GRAND_TOLERANCE:
            checks.append(
                _check(
                    "TOTAL_MISMATCH",
                    "warn",
                    {
                        "kind": "grand",
                        "base": _fmt(base),
                        "computed": _fmt(computed),
                        "printed": _fmt(grand),
                        "difference": _fmt(abs(computed - grand)),
                    },
                )
            )

    # --- reprint, confidence, matching ---
    if draft.get("is_reprint"):
        checks.append(_check("REPRINT_COPY", "warn"))

    low = []
    confidence = draft.get("confidence") or {}
    for field in _CONFIDENCE_FIELDS:
        if field in confidence and confidence[field] < LOW_CONFIDENCE:
            low.append({"field": field, "confidence": confidence[field]})
    for line in lines:
        if (line.get("confidence") or 0) < LOW_CONFIDENCE:
            low.append(
                {
                    "field": "line",
                    "line_id": line["line_id"],
                    "confidence": line.get("confidence") or 0,
                }
            )
    if low:
        checks.append(_check("LOW_CONFIDENCE", "warn", {"fields": low}))

    if lines and not any(line["match"]["state"] in ("matched", "check_match") for line in lines):
        checks.append(_check("ZERO_MATCH", "warn"))

    return checks
