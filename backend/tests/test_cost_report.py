"""§5 — primary + misc costing, and §6 trends."""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from inventory.models import DailyStock, Dish, Purchase, Sale, Wastage
from reports.services import cost_report, trends, week_bounds

pytestmark = pytest.mark.django_db

DAY = date(2026, 3, 2)


def _ingredient(report, code):
    return next(row for row in report["ingredients"] if row["code"] == code)


def _dish(report, code):
    return next(row for row in report["dishes"] if row["code"] == code)


def test_consumption_formula(business, worked_example):
    """consumed = opening + purchases - closing - wastage."""
    report = cost_report(business, DAY, DAY)
    row = _ingredient(report, "CHK")
    assert row["opening"] == Decimal("0.500")
    assert row["purchased"] == Decimal("5.000")
    assert row["closing"] == Decimal("0.800")
    assert row["wastage"] == Decimal("0.300")
    assert row["consumed"] == Decimal("4.400")  # 0.5 + 5 - 0.8 - 0.3
    assert row["cost"] == Decimal("1584.00")  # 4.4 x 360


def test_weighted_rate_uses_actual_purchases(business, chicken, vendor, worked_example):
    """Two purchases at different rates give a weighted average, not the standard rate."""
    Purchase.objects.create(
        business=business,
        date=DAY,
        vendor=vendor,
        ingredient=chicken,
        qty_invoiced=Decimal("5"),
        rate=Decimal("400"),
        qty_received=Decimal("5"),
    )
    report = cost_report(business, DAY, DAY)
    row = _ingredient(report, "CHK")
    assert row["weighted_rate"] == Decimal("380.00")  # (5x360 + 5x400) / 10


def test_standard_rate_is_the_fallback_with_no_purchases(business, chicken, chef):
    DailyStock.objects.create(
        business=business,
        ingredient=chicken,
        date=DAY,
        opening_qty=Decimal("2"),
        closing_qty=Decimal("1"),
        opened_by=chef,
        closed_by=chef,
    )
    report = cost_report(business, DAY, DAY)
    row = _ingredient(report, "CHK")
    assert row["weighted_rate"] == Decimal("360.00")
    assert row["cost"] == Decimal("360.00")


def test_a_missing_count_yields_no_cost_rather_than_zero(business, chicken, vendor):
    Purchase.objects.create(
        business=business,
        date=DAY,
        vendor=vendor,
        ingredient=chicken,
        qty_invoiced=Decimal("5"),
        rate=Decimal("360"),
        qty_received=Decimal("5"),
    )
    report = cost_report(business, DAY, DAY)
    row = _ingredient(report, "CHK")
    assert row["consumed"] is None
    assert row["cost"] is None
    assert row["missing_counts"] == ["opening", "closing"]


def test_shared_ingredients_are_pooled_not_attributed(business, oil, chef, worked_example):
    DailyStock.objects.create(
        business=business,
        ingredient=oil,
        date=DAY,
        opening_qty=Decimal("5"),
        closing_qty=Decimal("4"),
        opened_by=chef,
        closed_by=chef,
    )
    report = cost_report(business, DAY, DAY)

    oil_row = _ingredient(report, "OIL")
    assert oil_row["shared"] is True
    assert oil_row["cost_pct"] is None  # never attributed to one ingredient's dishes
    assert report["totals"]["shared_pool"] == Decimal("160.00")  # 1 kg x 160


def test_misc_cost_is_allocated_by_revenue_share(business, oil, chef, worked_example):
    DailyStock.objects.create(
        business=business,
        ingredient=oil,
        date=DAY,
        opening_qty=Decimal("5"),
        closing_qty=Decimal("4"),
        opened_by=chef,
        closed_by=chef,
    )
    report = cost_report(business, DAY, DAY)

    total_revenue = report["totals"]["revenue"]
    assert total_revenue == Decimal("8140.00")  # 20x260 + 10x210 + 6x140

    chilli = _dish(report, "D1")
    expected_misc = (Decimal("160") * Decimal("5200") / total_revenue).quantize(Decimal("0.01"))
    assert chilli["misc_cost"] == expected_misc

    allocated = sum(row["misc_cost"] for row in report["dishes"])
    assert abs(allocated - Decimal("160.00")) <= Decimal("0.03")  # rounding only


def test_primary_cost_splits_by_revenue_within_the_ingredient_group(business, worked_example):
    """All three dishes share one primary ingredient, so they split its cost by revenue."""
    report = cost_report(business, DAY, DAY)
    ingredient_cost = _ingredient(report, "CHK")["cost"]
    split = sum(row["primary_cost"] for row in report["dishes"])
    assert abs(split - ingredient_cost) <= Decimal("0.02")


def test_recipe_dishes_show_a_standard_cost_beside_the_actual(business, worked_example):
    report = cost_report(business, DAY, DAY)
    chilli = _dish(report, "D1")
    assert chilli["has_recipe"] is True
    # 150 g at 360/kg = 54.00 per plate
    assert chilli["standard_cost_per_plate"] == Decimal("54.00")
    assert chilli["standard_cost"] == Decimal("1080.00")
    assert chilli["est_cost_pct"] is not None
    assert chilli["standard_cost_pct"] is not None


def test_a_dish_without_a_recipe_has_no_standard_cost(business, chicken, manager, worked_example):
    plain = Dish.objects.create(
        business=business, code="D9", name="No recipe", price=Decimal("100"), ing=chicken
    )
    Sale.objects.create(
        business=business,
        date=DAY,
        dish=plain,
        plates=2,
        revenue=Decimal("200"),
        entered_by=manager,
    )
    report = cost_report(business, DAY, DAY)
    row = _dish(report, "D9")
    assert row["has_recipe"] is False
    assert row["standard_cost_per_plate"] is None
    assert row["est_cost_pct"] is not None  # §5 costing still applies


def test_opening_falls_back_to_the_previous_days_closing(business, chicken, chef):
    DailyStock.objects.create(
        business=business,
        ingredient=chicken,
        date=DAY - timedelta(days=1),
        closing_qty=Decimal("2.5"),
        closed_by=chef,
    )
    DailyStock.objects.create(
        business=business, ingredient=chicken, date=DAY, closing_qty=Decimal("1"), closed_by=chef
    )
    report = cost_report(business, DAY, DAY)
    row = _ingredient(report, "CHK")
    assert row["opening"] == Decimal("2.500")
    assert row["consumed"] == Decimal("1.500")


def test_closing_is_the_latest_in_the_range(business, chicken, chef):
    for offset, qty in [(0, "5"), (1, "4"), (2, "3")]:
        DailyStock.objects.create(
            business=business,
            ingredient=chicken,
            date=DAY + timedelta(days=offset),
            opening_qty=Decimal("6") if offset == 0 else None,
            closing_qty=Decimal(qty),
            closed_by=chef,
        )
    report = cost_report(business, DAY, DAY + timedelta(days=2))
    row = _ingredient(report, "CHK")
    assert row["closing"] == Decimal("3.000")


def test_wastage_over_threshold_alerts(business, chicken, chef, vendor, owner):
    from reports.services import threshold_alerts

    DailyStock.objects.create(
        business=business,
        ingredient=chicken,
        date=DAY,
        opening_qty=Decimal("10"),
        closing_qty=Decimal("2"),
        opened_by=chef,
        closed_by=chef,
    )
    Wastage.objects.create(
        business=business, date=DAY, ingredient=chicken, qty=Decimal("2"), reason="spoilage"
    )
    codes = {alert["code"] for alert in threshold_alerts(business, DAY, DAY)}
    assert "waste_over_threshold" in codes  # 2/10 = 20% against a 5% default


def test_rate_creep_alerts(business, chicken, vendor):
    from reports.services import operational_alerts

    Purchase.objects.create(
        business=business,
        date=DAY,
        vendor=vendor,
        ingredient=chicken,
        qty_invoiced=Decimal("1"),
        rate=Decimal("420"),
        qty_received=Decimal("1"),
    )
    codes = {alert["code"] for alert in operational_alerts(business, DAY, DAY)}
    assert "rate_creep" in codes  # 420 vs a 360 standard is +16.7%, over the 10% default


def test_rate_within_tolerance_does_not_alert(business, chicken, vendor):
    from reports.services import operational_alerts

    Purchase.objects.create(
        business=business,
        date=DAY,
        vendor=vendor,
        ingredient=chicken,
        qty_invoiced=Decimal("1"),
        rate=Decimal("390"),
        qty_received=Decimal("1"),
    )
    codes = {alert["code"] for alert in operational_alerts(business, DAY, DAY)}
    assert "rate_creep" not in codes  # +8.3%, inside the 10% default


def test_week_bounds_runs_monday_to_sunday():
    start, end = week_bounds(date(2026, 3, 5))  # a Thursday
    assert start == date(2026, 3, 2)
    assert end == date(2026, 3, 8)


def test_trends_returns_one_point_per_week(business, worked_example):
    result = trends(business, weeks=4, today=DAY)
    assert len(result["total"]) == 4
    assert result["total"][-1]["start"] == DAY  # the current week is last
    assert result["total"][-1]["revenue"] == Decimal("8140.00")
    assert result["total"][0]["revenue"] == Decimal("0.00")  # three weeks earlier, no data


def test_kitchen_efficiency_is_reported(business, worked_example):
    from reports.services import variance_report

    result = variance_report(business, DAY, DAY)
    # 0.92 kg unexplained out of 4.7 kg moved = ~80.4% efficient
    assert result["kitchen_efficiency_pct"] == Decimal("80.43")
