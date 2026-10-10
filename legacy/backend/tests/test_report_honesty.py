"""The report must never make missing data look like good news.

A food-cost tool that reports 0% when nobody counted the stock is worse than no tool: the owner acts on
a number that means "we don't know".
"""

from datetime import date
from decimal import Decimal

import pytest

from inventory.models import DailyStock
from reports.services import cost_report

pytestmark = pytest.mark.django_db

DAY = date(2026, 3, 2)


def test_no_counts_at_all_gives_unknown_cost_not_zero(business, chicken, worked_example):
    DailyStock.objects.filter(business=business).delete()

    totals = cost_report(business, DAY, DAY)["totals"]
    assert totals["revenue"] == Decimal("8140.00")
    assert totals["cost"] is None
    assert totals["cost_pct"] is None
    assert totals["complete"] is False
    assert totals["ingredients_costed"] == 0


def test_partial_counts_are_labelled_as_partial(business, chicken, oil, worked_example):
    """Chicken is counted, oil is not. The total is real but incomplete, and says so."""
    totals = cost_report(business, DAY, DAY)["totals"]
    assert totals["cost"] == Decimal("1584.00")
    assert totals["complete"] is False
    assert totals["ingredients_costed"] == 1
    assert totals["ingredients_total"] == 2
    assert "Oil" in totals["ingredients_missing_counts"]


def test_complete_counts_report_as_complete(business, chicken, oil, chef, worked_example):
    DailyStock.objects.create(
        business=business,
        ingredient=oil,
        date=DAY,
        opening_qty=Decimal("5"),
        closing_qty=Decimal("4"),
        opened_by=chef,
        closed_by=chef,
    )
    totals = cost_report(business, DAY, DAY)["totals"]
    assert totals["complete"] is True
    assert totals["ingredients_missing_counts"] == []
    assert totals["cost_pct"] is not None


def test_a_zero_cost_that_is_genuinely_zero_still_reads_as_zero(
    business, chicken, chef, worked_example
):
    """Nothing consumed is a real 0, and must not be confused with unknown."""
    DailyStock.objects.filter(business=business, ingredient=chicken).update(
        opening_qty=Decimal("5.8"), closing_qty=Decimal("10.5")
    )
    row = next(r for r in cost_report(business, DAY, DAY)["ingredients"] if r["code"] == "CHK")
    assert row["consumed"] == Decimal("0.000")  # 5.8 + 5 - 10.5 - 0.3
    assert row["cost"] == Decimal("0.00")
    assert row["cost"] is not None
