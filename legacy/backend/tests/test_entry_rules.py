"""Once-per-day capture, the impossible-count guard, short deliveries, and blind counts."""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.urls import reverse

from inventory.models import DailyStock, Purchase, Request, RequestStatus, Sale

pytestmark = pytest.mark.django_db

DAY = date(2026, 3, 2)


def _stock_url(business, which):
    return f"/api/tenants/{business.id}/stock/{which}"


class TestOncePerDay:
    def test_chef_captures_opening_once(self, api, chef, business, chicken):
        client = api(chef)
        payload = {"date": str(DAY), "ingredient": chicken.id, "qty": "5"}

        assert client.post(_stock_url(business, "open"), payload).status_code == 201

        second = client.post(_stock_url(business, "open"), {**payload, "qty": "7"})
        assert second.status_code == 409
        assert second.data["error"]["code"] == "already_captured"
        assert "Ask an Owner" in second.data["error"]["message"]

        stock = DailyStock.objects.get(business=business, ingredient=chicken, date=DAY)
        assert stock.opening_qty == Decimal("5.000")

    def test_owner_may_recapture_as_a_correction(self, api, chef, owner, business, chicken):
        payload = {"date": str(DAY), "ingredient": chicken.id, "qty": "5"}
        api(chef).post(_stock_url(business, "open"), payload)

        response = api(owner).post(_stock_url(business, "open"), {**payload, "qty": "6"})
        assert response.status_code == 201

        stock = DailyStock.objects.get(business=business, ingredient=chicken, date=DAY)
        assert stock.opening_qty == Decimal("6.000")

    def test_sales_are_once_per_dish_per_day(self, api, manager, business, worked_example):
        dish = worked_example["dishes"]["D1"]
        response = api(manager).post(
            reverse("sale-list", kwargs={"tenant_id": business.id}),
            {"date": str(DAY), "dish": dish.id, "plates": 5},
        )
        assert response.status_code == 409
        assert response.data["error"]["code"] == "already_captured"

    def test_staff_cannot_capture_stock_at_all(self, api, staff, business, chicken):
        response = api(staff).post(
            _stock_url(business, "open"), {"date": str(DAY), "ingredient": chicken.id, "qty": "1"}
        )
        assert response.status_code == 403


class TestImpossibleCount:
    def test_closing_cannot_exceed_opening_plus_purchases(self, api, chef, business, chicken):
        client = api(chef)
        client.post(
            _stock_url(business, "open"), {"date": str(DAY), "ingredient": chicken.id, "qty": "2"}
        )

        response = client.post(
            _stock_url(business, "close"), {"date": str(DAY), "ingredient": chicken.id, "qty": "3"}
        )
        assert response.status_code == 400
        assert response.data["error"]["code"] == "impossible_count"
        assert response.data["error"]["detail"]["ceiling"] == "2.000"

    def test_the_days_purchases_raise_the_ceiling(self, api, chef, business, chicken, vendor):
        client = api(chef)
        client.post(
            _stock_url(business, "open"), {"date": str(DAY), "ingredient": chicken.id, "qty": "2"}
        )
        Purchase.objects.create(
            business=business,
            date=DAY,
            vendor=vendor,
            ingredient=chicken,
            qty_invoiced=Decimal("5"),
            rate=Decimal("360"),
            qty_received=Decimal("5"),
        )
        response = client.post(
            _stock_url(business, "close"),
            {"date": str(DAY), "ingredient": chicken.id, "qty": "6.5"},
        )
        assert response.status_code == 201

    def test_a_count_exactly_at_the_ceiling_is_allowed(self, api, chef, business, chicken):
        client = api(chef)
        client.post(
            _stock_url(business, "open"), {"date": str(DAY), "ingredient": chicken.id, "qty": "2"}
        )
        response = client.post(
            _stock_url(business, "close"), {"date": str(DAY), "ingredient": chicken.id, "qty": "2"}
        )
        assert response.status_code == 201

    def test_closing_without_an_opening_uses_the_previous_days_closing(
        self, api, chef, business, chicken
    ):
        DailyStock.objects.create(
            business=business,
            ingredient=chicken,
            date=DAY - timedelta(days=1),
            closing_qty=Decimal("4"),
        )
        response = api(chef).post(
            _stock_url(business, "close"),
            {"date": str(DAY), "ingredient": chicken.id, "qty": "3.5"},
        )
        assert response.status_code == 201


class TestOpeningPrefill:
    def test_opening_suggestion_carries_yesterdays_closing_forward(
        self, api, chef, business, chicken
    ):
        DailyStock.objects.create(
            business=business,
            ingredient=chicken,
            date=DAY - timedelta(days=1),
            closing_qty=Decimal("3.25"),
        )
        response = api(chef).get(f"/api/tenants/{business.id}/stock?date={DAY}")
        row = next(r for r in response.data["rows"] if r["ingredient"] == chicken.id)
        assert Decimal(str(row["suggested_opening"])) == Decimal("3.250")

    def test_first_ever_day_suggests_zero(self, api, chef, business, chicken):
        response = api(chef).get(f"/api/tenants/{business.id}/stock?date={DAY}")
        row = next(r for r in response.data["rows"] if r["ingredient"] == chicken.id)
        assert Decimal(str(row["suggested_opening"])) == Decimal("0")


class TestStockLedger:
    """The stock screen is a ledger, not just opening/closing — it also reflects today's own
    wastage entries back, and tells the client who may add a new item to track."""

    def test_wastage_today_sums_every_entry_so_far(self, api, chef, business, chicken):
        from inventory.models import Wastage

        Wastage.objects.create(
            business=business, date=DAY, ingredient=chicken, qty=Decimal("0.2"), reason="spoilage"
        )
        Wastage.objects.create(
            business=business, date=DAY, ingredient=chicken, qty=Decimal("0.1"), reason="spill"
        )
        response = api(chef).get(f"/api/tenants/{business.id}/stock?date={DAY}")
        row = next(r for r in response.data["rows"] if r["ingredient"] == chicken.id)
        assert Decimal(str(row["wastage_today"])) == Decimal("0.300")

    def test_wastage_today_is_zero_not_missing_when_nothing_logged(
        self, api, chef, business, chicken
    ):
        response = api(chef).get(f"/api/tenants/{business.id}/stock?date={DAY}")
        row = next(r for r in response.data["rows"] if r["ingredient"] == chicken.id)
        assert Decimal(str(row["wastage_today"])) == Decimal("0")

    def test_showing_logged_wastage_is_not_a_blind_count_violation(
        self, api, chef, business, chicken
    ):
        """Reflecting what the chef just typed back to them is not the same as revealing an
        expected-usage or variance figure computed from sales (non-negotiable #4)."""
        response = api(chef).get(f"/api/tenants/{business.id}/stock?date={DAY}")
        row = next(r for r in response.data["rows"] if r["ingredient"] == chicken.id)
        assert {"expected", "variance", "unexplained", "sales", "revenue"}.isdisjoint(row.keys())

    def test_can_add_ingredient_true_for_manager(self, api, manager, business):
        response = api(manager).get(f"/api/tenants/{business.id}/stock?date={DAY}")
        assert response.data["can_add_ingredient"] is True

    def test_can_add_ingredient_true_for_owner(self, api, owner, business):
        response = api(owner).get(f"/api/tenants/{business.id}/stock?date={DAY}")
        assert response.data["can_add_ingredient"] is True

    def test_can_add_ingredient_false_for_head_chef(self, api, chef, business):
        response = api(chef).get(f"/api/tenants/{business.id}/stock?date={DAY}")
        assert response.data["can_add_ingredient"] is False


class TestBlindCounts:
    """Non-negotiable #4 — the stock screen must not reveal what the count 'should' be."""

    FORBIDDEN_KEYS = {
        "expected",
        "variance",
        "unexplained",
        "sales",
        "plates",
        "revenue",
        "expected_closing",
    }

    def test_stock_screen_shows_no_expected_figure(self, api, chef, business, worked_example):
        response = api(chef).get(f"/api/tenants/{business.id}/stock?date={DAY}")
        assert response.status_code == 200
        for row in response.data["rows"]:
            assert self.FORBIDDEN_KEYS.isdisjoint(row.keys()), row.keys()

    def test_chef_day_view_withholds_sales(self, api, chef, business, worked_example):
        response = api(chef).get(f"/api/tenants/{business.id}/day/{DAY}")
        assert response.status_code == 200
        assert "sales" not in response.data

    def test_manager_day_view_includes_sales(self, api, manager, business, worked_example):
        response = api(manager).get(f"/api/tenants/{business.id}/day/{DAY}")
        assert "sales" in response.data

    def test_chef_cannot_read_the_variance_report(self, api, chef, business):
        assert api(chef).get(f"/api/tenants/{business.id}/variance").status_code == 403

    def test_chef_cannot_list_sales(self, api, chef, business, worked_example):
        """Listing sales is as revealing as the report. Gating only writes would leave the door open."""
        assert api(chef).get(f"/api/tenants/{business.id}/sales/").status_code == 403
        assert api(chef).get(f"/api/tenants/{business.id}/sales-imports/").status_code == 403

    def test_staff_cannot_list_sales(self, api, staff, business, worked_example):
        assert api(staff).get(f"/api/tenants/{business.id}/sales/").status_code == 403

    def test_manager_can_list_sales(self, api, manager, business, worked_example):
        assert api(manager).get(f"/api/tenants/{business.id}/sales/").status_code == 200

    def test_chef_home_has_no_sales_or_variance(self, api, chef, business, worked_example):
        response = api(chef).get(f"/api/tenants/{business.id}/home")
        assert response.status_code == 200
        blob = str(response.data).lower()
        assert "variance" not in blob
        assert "unexplained" not in blob
        assert "revenue" not in blob

    def test_chef_alerts_exclude_variance(self, api, chef, business, worked_example):
        response = api(chef).get(f"/api/tenants/{business.id}/alerts?start={DAY}&end={DAY}")
        codes = {alert["code"] for alert in response.data}
        assert "unexplained_variance" not in codes

    def test_owner_alerts_include_variance(self, api, owner, business, worked_example):
        response = api(owner).get(f"/api/tenants/{business.id}/alerts?start={DAY}&end={DAY}")
        codes = {alert["code"] for alert in response.data}
        assert "unexplained_variance" in codes


class TestReceiveGoods:
    def test_short_delivery_is_flagged(self, api, chef, business, chicken, vendor, owner):
        response = api(chef).post(
            reverse("purchase-list", kwargs={"tenant_id": business.id}),
            {
                "date": str(DAY),
                "vendor": vendor.id,
                "ingredient": chicken.id,
                "qty_invoiced": "10",
                "rate": "360",
                "qty_received": "8",
            },
        )
        assert response.status_code == 201
        assert response.data["is_short"] is True
        # amount bills what the vendor invoiced, not what arrived
        assert Decimal(str(response.data["amount"])) == Decimal("3600.00")

        alerts = api(owner).get(f"/api/tenants/{business.id}/alerts?start={DAY}&end={DAY}").data
        assert any(alert["code"] == "short_delivery" for alert in alerts)

    def test_receiving_more_than_invoiced_is_rejected(self, api, chef, business, chicken, vendor):
        response = api(chef).post(
            reverse("purchase-list", kwargs={"tenant_id": business.id}),
            {
                "date": str(DAY),
                "vendor": vendor.id,
                "ingredient": chicken.id,
                "qty_invoiced": "5",
                "rate": "360",
                "qty_received": "6",
            },
        )
        assert response.status_code == 400

    def test_a_purchase_naming_a_request_closes_it(
        self, api, chef, manager, business, chicken, vendor
    ):
        request = Request.objects.create(
            business=business, date=DAY, ingredient=chicken, qty=Decimal("5"), requested_by=chef
        )
        response = api(manager).post(
            reverse("purchase-list", kwargs={"tenant_id": business.id}),
            {
                "date": str(DAY),
                "vendor": vendor.id,
                "ingredient": chicken.id,
                "qty_invoiced": "5",
                "rate": "360",
                "qty_received": "5",
                "request": request.id,
            },
        )
        assert response.status_code == 201
        request.refresh_from_db()
        assert request.status == RequestStatus.FULFILLED
        assert request.fulfilled_purchase_id == response.data["id"]

    def test_a_request_for_a_different_ingredient_is_rejected(
        self, api, manager, business, chicken, oil, vendor, chef
    ):
        request = Request.objects.create(
            business=business, date=DAY, ingredient=oil, qty=Decimal("5"), requested_by=chef
        )
        response = api(manager).post(
            reverse("purchase-list", kwargs={"tenant_id": business.id}),
            {
                "date": str(DAY),
                "vendor": vendor.id,
                "ingredient": chicken.id,
                "qty_invoiced": "5",
                "rate": "360",
                "qty_received": "5",
                "request": request.id,
            },
        )
        assert response.status_code == 400


class TestWastageReasons:
    def test_other_requires_a_note(self, api, staff, business, chicken):
        response = api(staff).post(
            reverse("wastage-list", kwargs={"tenant_id": business.id}),
            {"date": str(DAY), "ingredient": chicken.id, "qty": "1", "reason": "other"},
        )
        assert response.status_code == 400
        assert "note" in response.data["error"]["detail"]

    def test_other_with_a_note_is_accepted(self, api, staff, business, chicken):
        response = api(staff).post(
            reverse("wastage-list", kwargs={"tenant_id": business.id}),
            {
                "date": str(DAY),
                "ingredient": chicken.id,
                "qty": "1",
                "reason": "other",
                "note": "Power cut, freezer off overnight",
            },
        )
        assert response.status_code == 201

    def test_the_report_breaks_wastage_down_by_reason(self, api, owner, business, worked_example):
        response = api(owner).get(f"/api/tenants/{business.id}/report?start={DAY}&end={DAY}")
        breakdown = response.data["wastage_by_reason"]
        assert breakdown[0]["reason"] == "spoilage"
        assert Decimal(str(breakdown[0]["qty"])) == Decimal("0.300")


class TestDishConstraints:
    def test_a_shared_ingredient_cannot_be_a_dishs_primary(self, api, manager, business, oil):
        response = api(manager).post(
            reverse("dish-list", kwargs={"tenant_id": business.id}),
            {"code": "BAD", "name": "Oil dish", "price": "100", "ing": oil.id},
        )
        assert response.status_code == 400
        assert "ing" in response.data["error"]["detail"]

    def test_a_shared_ingredient_cannot_get_a_recipe_line(
        self, api, manager, business, oil, worked_example
    ):
        dish = worked_example["dishes"]["D1"]
        response = api(manager).post(
            f"/api/tenants/{business.id}/dishes/{dish.id}/recipe/",
            {"ingredient": oil.id, "qty_per_portion": "10"},
        )
        assert response.status_code == 400


class TestSegregationFlag:
    def test_one_person_doing_both_is_flagged_not_blocked(
        self, api, owner, business, chicken, chef, manager
    ):
        """§1b: flag only. A two-person restaurant must still be able to operate."""
        DailyStock.objects.create(
            business=business,
            ingredient=chicken,
            date=DAY,
            opening_qty=Decimal("1"),
            opened_by=manager,
            closing_qty=Decimal("0.5"),
            closed_by=manager,
        )
        from inventory.models import Dish

        dish = Dish.objects.create(
            business=business, code="S1", name="Sale dish", price=Decimal("100"), ing=chicken
        )
        Sale.objects.create(
            business=business,
            date=DAY,
            dish=dish,
            plates=1,
            revenue=Decimal("100"),
            entered_by=manager,
        )

        report = api(owner).get(f"/api/tenants/{business.id}/report?start={DAY}&end={DAY}").data
        flags = report["segregation_flags"]
        assert len(flags) == 1
        assert flags[0]["user"] == "Manager"

    def test_owner_entries_are_exempt(self, api, owner, business, chicken):
        DailyStock.objects.create(
            business=business,
            ingredient=chicken,
            date=DAY,
            opening_qty=Decimal("1"),
            opened_by=owner,
            closing_qty=Decimal("0.5"),
            closed_by=owner,
        )
        from inventory.models import Dish

        dish = Dish.objects.create(
            business=business, code="S2", name="Owner dish", price=Decimal("100"), ing=chicken
        )
        Sale.objects.create(
            business=business,
            date=DAY,
            dish=dish,
            plates=1,
            revenue=Decimal("100"),
            entered_by=owner,
        )
        report = api(owner).get(f"/api/tenants/{business.id}/report?start={DAY}&end={DAY}").data
        assert report["segregation_flags"] == []
