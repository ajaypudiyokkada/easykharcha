"""§5b — expected vs actual, and the coverage rule that decides whether to alert at all."""

from decimal import Decimal

import pytest

from inventory.models import Dish, RecipeLine, Sale
from reports.services import VarianceFigures, variance_report

pytestmark = pytest.mark.django_db


def _row(business, start, end, code="CHK"):
    report = variance_report(business, start, end)
    return next(row for row in report["rows"] if row["code"] == code)


def test_worked_example_from_the_spec(business, worked_example):
    """docs/product.md §5b: expected 3.48, actual 4.7, unexplained 0.92 kg (~26.4%) => alert."""
    row = _row(business, worked_example["start"], worked_example["end"])

    assert row["expected"] == Decimal("3.480")
    assert row["actual_used"] == Decimal("4.700")
    assert row["wastage"] == Decimal("0.300")
    assert row["unexplained"] == Decimal("0.920")
    assert row["unexplained_pct"] == Decimal("26.44")
    assert row["unexplained_value"] == Decimal("331.20")  # 0.92 kg x 360/kg
    assert row["coverage_pct"] == Decimal("100.00")
    assert row["status"] == "alert"
    assert row["alert"] is True


def test_unexplained_equals_consumed_minus_expected(business, worked_example):
    """The spec's own identity check: unexplained == consumed - expected."""
    from reports.services import cost_report

    variance_row = _row(business, worked_example["start"], worked_example["end"])
    cost_row = next(
        row
        for row in cost_report(business, worked_example["start"], worked_example["end"])[
            "ingredients"
        ]
        if row["code"] == "CHK"
    )
    assert variance_row["unexplained"] == cost_row["consumed"] - variance_row["expected"]


def test_partial_recipe_coverage_suppresses_the_alert(business, chicken, worked_example, manager):
    """A dish that uses the ingredient but has no recipe must drop coverage and silence the alert.

    This is the "don't cry wolf on a half-configured ingredient" rule — the most important guard in the
    whole variance feature.
    """
    uncovered = Dish.objects.create(
        business=business, code="D4", name="Chicken roast", price=Decimal("300"), ing=chicken
    )
    Sale.objects.create(
        business=business,
        date=worked_example["start"],
        dish=uncovered,
        plates=5,
        revenue=Decimal("1500"),
        entered_by=manager,
    )

    row = _row(business, worked_example["start"], worked_example["end"])
    assert row["status"] == "incomplete_recipes"
    assert row["alert"] is False
    assert row["coverage_pct"] < Decimal("100")


def test_missing_count_is_unknown_not_zero(business, chicken, worked_example):
    """A missing closing count must read as "we don't know", never as zero consumption."""
    from inventory.models import DailyStock

    DailyStock.objects.filter(business=business, ingredient=chicken).update(closing_qty=None)

    row = _row(business, worked_example["start"], worked_example["end"])
    assert row["actual_used"] is None
    assert row["unexplained"] is None
    assert row["status"] == "missing_counts"
    assert row["alert"] is False


def test_negative_variance_also_alerts(business, chicken, worked_example):
    """Over-reported usage or a too-generous recipe is just as wrong as missing stock."""
    RecipeLine.objects.filter(ingredient=chicken, dish__code="D1").update(
        qty_per_portion=Decimal("300")
    )
    row = _row(business, worked_example["start"], worked_example["end"])
    assert row["unexplained"] < 0
    assert row["status"] == "alert"


def test_per_ingredient_threshold_overrides_the_tenant_default(business, chicken, worked_example):
    chicken.variance_alert_pct = Decimal("40")
    chicken.save(update_fields=["variance_alert_pct"])

    row = _row(business, worked_example["start"], worked_example["end"])
    assert row["threshold_pct"] == Decimal("40.00")
    assert row["status"] == "ok"  # 26.44% is now inside tolerance
    assert row["alert"] is False


def test_shared_ingredients_never_appear_in_variance(business, oil, worked_example):
    report = variance_report(business, worked_example["start"], worked_example["end"])
    assert all(row["code"] != "OIL" for row in report["rows"])


def test_yield_increases_expected_usage(business, chicken, worked_example):
    """80% yield means 150 g on the plate needs 187.5 g bought."""
    chicken.yield_pct = Decimal("80")
    chicken.save(update_fields=["yield_pct"])

    row = _row(business, worked_example["start"], worked_example["end"])
    assert row["expected"] == Decimal("4.350")  # 3.48 / 0.8


def test_implied_portion_is_only_offered_for_single_dish_ingredients(
    business, chicken, worked_example
):
    """Three dishes share the chicken, so no per-plate figure can be implied."""
    row = _row(business, worked_example["start"], worked_example["end"])
    assert row["dishes_using"] == 3
    assert row["implied_portion"] is None


def test_implied_portion_suggests_what_the_kitchen_actually_uses(business, chicken, worked_example):
    Sale.objects.filter(business=business).exclude(dish__code="D1").delete()
    RecipeLine.objects.filter(ingredient=chicken).exclude(dish__code="D1").delete()
    Dish.objects.filter(business=business).exclude(code="D1").delete()

    row = _row(business, worked_example["start"], worked_example["end"])
    suggestion = row["implied_portion"]
    # consumed 4.4 kg over 20 plates = 220 g/plate against a 150 g recipe.
    assert suggestion["implied_qty_per_portion"] == Decimal("220.000")
    assert suggestion["recipe_qty_per_portion"] == Decimal("150.000")
    assert suggestion["unit"] == "g"


class TestVarianceFiguresArithmetic:
    """The formula on its own, with no database involved."""

    def test_matches_the_spec_example(self):
        figures = VarianceFigures(
            actual_used=Decimal("4.7"),
            expected=Decimal("3.48"),
            wastage=Decimal("0.3"),
            rate=Decimal("360"),
        )
        assert figures.unexplained == Decimal("0.92")
        assert figures.pct == Decimal("26.44")
        assert figures.value == Decimal("331.20")

    def test_unknown_usage_propagates_as_none(self):
        figures = VarianceFigures(
            actual_used=None, expected=Decimal("3.48"), wastage=Decimal("0"), rate=Decimal("360")
        )
        assert figures.unexplained is None
        assert figures.pct is None
        assert figures.value is None

    def test_zero_expected_gives_no_percentage(self):
        figures = VarianceFigures(
            actual_used=Decimal("1"),
            expected=Decimal("0"),
            wastage=Decimal("0"),
            rate=Decimal("10"),
        )
        assert figures.unexplained == Decimal("1")
        assert figures.pct is None
