"""§5c — POS sales import: parser registry, matching, reconciliation, idempotency.

The behaviours worth defending here are the ones that would corrupt data silently:
fuzzy matches are never auto-accepted, manual entries are never overwritten, and confirming the same
file twice does not double-count.
"""

import io
from datetime import date
from decimal import Decimal

import pytest

from imports.parsers import detect, formats, parse
from imports.parsers.base import business_date
from inventory.models import DishAlias, Sale, SalesImport, SaleSource

pytestmark = pytest.mark.django_db

DAY = date(2026, 3, 2)
HEADER = "Date,Item Name,Quantity,Amount"


def _csv(rows, header=HEADER):
    return (header + "\n" + "\n".join(rows)).encode("utf-8")


def _upload(client, business, path, rows, header=HEADER, **extra):
    handle = io.BytesIO(_csv(rows, header))
    handle.name = "pos-export.csv"
    return client.post(
        f"/api/tenants/{business.id}/sales/import/{path}",
        {"file": handle, **extra},
        format="multipart",
    )


# ---------------------------------------------------------------------------------------------
# Registry and parsing
# ---------------------------------------------------------------------------------------------


class TestRegistry:
    def test_formats_are_listed_for_the_dropdown(self, api, manager, business):
        response = api(manager).get(f"/api/tenants/{business.id}/sales/import/formats")
        assert response.status_code == 200
        keys = [entry["key"] for entry in response.data["formats"]]
        assert "generic" in keys
        assert response.data["default"] == "auto"

    def test_a_chef_cannot_list_formats(self, api, chef, business):
        assert api(chef).get(f"/api/tenants/{business.id}/sales/import/formats").status_code == 403

    def test_header_is_found_below_a_title_block(self):
        """Real exports put a title block above the header; row 0 is not the header."""
        table = [
            ["Date:", "2026-03-01 to 2026-03-31"],
            ["Name:", "Item-wise Sales"],
            [],
            ["Date", "Item Name", "Quantity", "Amount"],
            ["2026-03-02", "Chilli chicken", 3, 780],
        ]
        parser, score = detect(table)
        assert parser is not None
        assert parser.find_header(table) == 3

    def test_an_unreadable_file_is_refused_rather_than_guessed(self):
        from core.exceptions import BusinessRuleError

        with pytest.raises(BusinessRuleError) as caught:
            parse("x.csv", b"Something,Else\na,b")
        assert caught.value.code in ("missing_columns", "header_not_found", "format_not_detected")

    def test_unknown_extension_is_refused(self):
        from core.exceptions import BusinessRuleError

        with pytest.raises(BusinessRuleError) as caught:
            parse("report.pdf", b"anything")
        assert caught.value.code == "unsupported_file"


class TestBusinessDayCutoff:
    def test_an_after_midnight_order_belongs_to_the_previous_night(self):
        import datetime

        when = datetime.datetime(2026, 3, 3, 1, 30)
        assert business_date(when, cutoff_hour=4) == date(2026, 3, 2)

    def test_an_evening_order_stays_on_its_own_day(self):
        import datetime

        when = datetime.datetime(2026, 3, 2, 23, 38)
        assert business_date(when, cutoff_hour=4) == date(2026, 3, 2)

    def test_a_date_without_a_time_is_never_shifted(self):
        """A date-only column is already a business date; shifting it would move every row back."""
        result = parse("x.csv", _csv(["10/03/2026,Chilli chicken,7,1820"]), cutoff_hour=4)
        assert result.rows[0].business_date == date(2026, 3, 10)

    def test_a_timestamped_row_is_shifted(self):
        result = parse("x.csv", _csv(["2026-03-10 01:15:00,Chilli chicken,7,1820"]), cutoff_hour=4)
        assert result.rows[0].business_date == date(2026, 3, 9)


# ---------------------------------------------------------------------------------------------
# Preview: matching and reconciliation
# ---------------------------------------------------------------------------------------------


class TestPreview:
    def test_preview_matches_and_writes_nothing(self, api, manager, business, worked_example):
        response = _upload(
            api(manager),
            business,
            "preview",
            ["2026-03-10,Chilli chicken,7,1820", "2026-03-10,Chicken soup,3,420"],
        )
        assert response.status_code == 200
        assert response.data["counts"]["matched_groups"] == 2
        assert response.data["unmatched"] == []
        assert not Sale.objects.filter(date="2026-03-10").exists()

    def test_pos_alias_beats_the_dish_name(self, api, manager, business, worked_example):
        dish = worked_example["dishes"]["D1"]
        dish.pos_alias = "CHILI CHKN [DRY]"
        dish.save(update_fields=["pos_alias"])

        response = _upload(
            api(manager), business, "preview", ["2026-03-10,CHILI CHKN [DRY],4,1040"]
        )
        assert response.data["matched"][0]["dish"] == dish.id

    def test_matching_ignores_case_spacing_and_punctuation(
        self, api, manager, business, worked_example
    ):
        response = _upload(
            api(manager), business, "preview", ["2026-03-10,  CHILLI   CHICKEN ,4,1040"]
        )
        assert response.data["counts"]["matched_groups"] == 1

    def test_fuzzy_is_a_suggestion_never_an_automatic_match(
        self, api, manager, business, worked_example
    ):
        """A wrong auto-match moves one dish's plates onto another and corrupts both variance rows."""
        response = _upload(
            api(manager), business, "preview", ["2026-03-10,Chilli Chicken Dry,4,1040"]
        )
        assert response.data["matched"] == []
        assert len(response.data["unmatched"]) == 1
        suggestions = response.data["unmatched"][0]["suggestions"]
        assert suggestions[0]["dish_name"] == "Chilli chicken"
        assert 0 < suggestions[0]["score"] <= 1

    def test_unmatched_impact_is_reported_so_skipping_is_informed(
        self, api, manager, business, worked_example
    ):
        response = _upload(api(manager), business, "preview", ["2026-03-10,Mystery dish,5,1000"])
        assert Decimal(str(response.data["unmatched_impact"]["plates"])) == Decimal("5")
        assert Decimal(str(response.data["unmatched_impact"]["revenue"])) == Decimal("1000")

    def test_rows_are_aggregated_per_dish_per_day(self, api, manager, business, worked_example):
        response = _upload(
            api(manager),
            business,
            "preview",
            [
                "2026-03-10,Chilli chicken,3,780",
                "2026-03-10,Chilli chicken,4,1040",
                "2026-03-11,Chilli chicken,2,520",
            ],
        )
        groups = {str(row["date"]): row for row in response.data["matched"]}
        assert Decimal(str(groups["2026-03-10"]["plates"])) == Decimal("7")
        assert Decimal(str(groups["2026-03-10"]["revenue"])) == Decimal("1820")
        assert Decimal(str(groups["2026-03-11"]["plates"])) == Decimal("2")

    def test_unreadable_rows_are_reported_not_dropped(self, api, manager, business, worked_example):
        response = _upload(
            api(manager),
            business,
            "preview",
            ["not-a-date,Chilli chicken,3,780", "2026-03-10,Chilli chicken,4,1040"],
        )
        assert response.data["counts"]["rows_excluded"] == 1
        assert "unreadable date" in response.data["excluded"][0]["reason"]

    def test_reconciliation_reports_when_there_is_nothing_to_check(
        self, api, manager, business, worked_example
    ):
        response = _upload(api(manager), business, "preview", ["2026-03-10,Chilli chicken,7,1820"])
        reconciliation = response.data["reconciliation"]
        assert Decimal(str(reconciliation["parsed_total"])) == Decimal("1820")
        assert reconciliation["file_total"] is None
        assert reconciliation["matches"] is None

    def test_missing_columns_are_named(self, api, manager, business):
        response = _upload(api(manager), business, "preview", ["a,b"], header="Something,Else")
        assert response.status_code == 400
        assert response.data["error"]["code"] in ("missing_columns", "format_not_detected")


# ---------------------------------------------------------------------------------------------
# Confirm
# ---------------------------------------------------------------------------------------------


class TestConfirm:
    def test_confirm_writes_sales_marked_as_imported(self, api, manager, business, worked_example):
        response = _upload(api(manager), business, "confirm", ["2026-03-10,Chilli chicken,7,1820"])
        assert response.status_code == 200

        sale = Sale.objects.get(date="2026-03-10")
        assert sale.plates == 7
        assert sale.revenue == Decimal("1820.00")
        assert sale.source == SaleSource.IMPORT
        assert sale.import_batch is not None
        assert SalesImport.objects.get().format_key == "generic"

    def test_reimport_replaces_only_imported_rows(self, api, manager, business, worked_example):
        _upload(api(manager), business, "confirm", ["2026-03-10,Chilli chicken,7,1820"])
        _upload(api(manager), business, "confirm", ["2026-03-10,Chilli chicken,9,2340"])

        sales = Sale.objects.filter(date="2026-03-10")
        assert sales.count() == 1
        assert sales.first().plates == 9

    def test_confirming_the_same_file_twice_is_a_no_op(
        self, api, manager, business, worked_example
    ):
        """A manager on bad wifi will press the button again. That must not double the day's sales."""
        rows = ["2026-03-10,Chilli chicken,7,1820"]
        first = _upload(api(manager), business, "confirm", rows)
        second = _upload(api(manager), business, "confirm", rows)

        assert first.data["already_imported"] is False
        assert second.data["already_imported"] is True
        assert second.data["created"] == 0
        assert "already imported" in second.data["message"].lower()
        assert Sale.objects.filter(date="2026-03-10").count() == 1
        assert SalesImport.objects.count() == 1

    def test_a_manual_row_is_never_overwritten(self, api, manager, business, worked_example):
        """The fixture already holds a manual sale for Chilli chicken on DAY."""
        response = _upload(api(manager), business, "confirm", [f"{DAY},Chilli chicken,99,99999"])
        assert response.status_code == 400

        existing = Sale.objects.get(date=DAY, dish__code="D1")
        assert existing.plates == 20
        assert existing.source == SaleSource.MANUAL

    def test_a_manual_clash_is_reported_in_the_preview(
        self, api, manager, business, worked_example
    ):
        response = _upload(api(manager), business, "preview", [f"{DAY},Chilli chicken,99,99999"])
        assert response.data["counts"]["blocked_by_manual"] == 1
        assert response.data["blocked_by_manual"][0]["dish_name"] == "Chilli chicken"

    def test_nothing_matched_is_refused_with_the_item_names(
        self, api, manager, business, worked_example
    ):
        response = _upload(api(manager), business, "confirm", ["2026-03-10,Totally unknown,5,500"])
        assert response.status_code == 400
        assert response.data["error"]["code"] == "nothing_matched"
        assert "Totally unknown" in response.data["error"]["detail"]["unmatched"]


# ---------------------------------------------------------------------------------------------
# Aliases and plate multipliers
# ---------------------------------------------------------------------------------------------


class TestAliases:
    def test_an_alias_is_saved_and_applied_in_the_same_request(
        self, api, manager, business, worked_example
    ):
        import json

        dish = worked_example["dishes"]["D2"]
        response = _upload(
            api(manager),
            business,
            "confirm",
            ["2026-03-11,NOODLE CHKN,5,1050"],
            aliases=json.dumps({"NOODLE CHKN": dish.id}),
        )
        assert response.status_code == 200
        assert DishAlias.objects.get(business=business).dish == dish
        assert Sale.objects.filter(date="2026-03-11", dish=dish).exists()

    def test_a_half_portion_alias_counts_as_half_a_plate(
        self, api, manager, business, worked_example
    ):
        """A POS that sells "Chilli Chicken (Half)" separately should not inflate the plate count."""
        import json

        dish = worked_example["dishes"]["D1"]
        response = _upload(
            api(manager),
            business,
            "confirm",
            ["2026-03-12,Chilli Chicken (Half),6,2340"],
            aliases=json.dumps(
                {"Chilli Chicken (Half)": {"dish": dish.id, "plate_multiplier": 0.5}}
            ),
        )
        assert response.status_code == 200
        assert Sale.objects.get(date="2026-03-12", dish=dish).plates == 3

    def test_an_alias_survives_for_the_next_import(self, api, manager, business, worked_example):
        import json

        dish = worked_example["dishes"]["D2"]
        _upload(
            api(manager),
            business,
            "confirm",
            ["2026-03-11,NOODLE CHKN,5,1050"],
            aliases=json.dumps({"NOODLE CHKN": dish.id}),
        )
        response = _upload(api(manager), business, "preview", ["2026-03-13,NOODLE CHKN,2,420"])
        assert response.data["counts"]["matched_groups"] == 1
        assert response.data["unmatched"] == []


# ---------------------------------------------------------------------------------------------
# Permissions and isolation
# ---------------------------------------------------------------------------------------------


class TestAccess:
    def test_a_chef_cannot_import(self, api, chef, business, worked_example):
        assert (
            _upload(
                api(chef), business, "preview", ["2026-03-10,Chilli chicken,7,1820"]
            ).status_code
            == 403
        )

    def test_staff_cannot_import(self, api, staff, business, worked_example):
        assert (
            _upload(
                api(staff), business, "confirm", ["2026-03-10,Chilli chicken,7,1820"]
            ).status_code
            == 403
        )

    def test_cannot_import_into_another_tenant(self, api, manager, other_business):
        response = _upload(api(manager), other_business, "preview", ["2026-03-10,X,1,10"])
        assert response.status_code == 404

    def test_an_alias_cannot_point_at_another_tenants_dish(
        self, api, manager, business, other_business, worked_example
    ):
        """A dish id from another tenant must be ignored, not silently linked."""
        import json

        from inventory.models import Dish, Ingredient, Vendor

        vendor = Vendor.objects.create(business=other_business, code="RV", name="Rival")
        ingredient = Ingredient.objects.create(
            business=other_business,
            code="RI",
            name="Rival chicken",
            unit="kg",
            rate=Decimal("300"),
            vendor=vendor,
        )
        theirs = Dish.objects.create(
            business=other_business,
            code="RD",
            name="Rival dish",
            price=Decimal("100"),
            ing=ingredient,
        )
        _upload(
            api(manager),
            business,
            "confirm",
            ["2026-03-14,Mystery,3,300"],
            aliases=json.dumps({"Mystery": theirs.id}),
        )
        assert not DishAlias.objects.filter(dish=theirs).exists()


def test_formats_helper_lists_the_generic_parser():
    assert any(entry["key"] == "generic" for entry in formats())
