from datetime import date, timedelta
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from accounts.models import Access, User
from core.roles import Role
from inventory.models import (
    Confidence,
    DailyStock,
    Dish,
    Ingredient,
    Purchase,
    RecipeLine,
    Sale,
    Vendor,
    Wastage,
    WastageReason,
)
from tenants.models import Business

DAY = date(2026, 3, 2)  # a Monday, so week_bounds(DAY) == (DAY, DAY+6)


@pytest.fixture
def business(db):
    return Business.objects.create(name="Test Kitchen", default_target_pct=Decimal("30"))


@pytest.fixture
def other_business(db):
    return Business.objects.create(name="Rival Kitchen")


@pytest.fixture
def make_user(db):
    def _make(phone, name="", role=Role.STAFF, business=None, pin="1234"):
        user = User.objects.create_user(phone=phone, name=name or phone, pin=pin)
        Access.objects.create(business=business, user=user, role=role, active=True)
        return user

    return _make


@pytest.fixture
def owner(business, make_user):
    return make_user("9100000001", "Owner", Role.OWNER, business)


@pytest.fixture
def manager(business, make_user):
    return make_user("9100000002", "Manager", Role.MANAGER, business)


@pytest.fixture
def chef(business, make_user):
    return make_user("9100000003", "Chef", Role.HEAD_CHEF, business)


@pytest.fixture
def staff(business, make_user):
    return make_user("9100000004", "Staff", Role.STAFF, business)


@pytest.fixture
def superadmin(db, make_user):
    return make_user("9100000009", "SA", Role.SUPER_ADMIN, None)


@pytest.fixture
def api():
    def _client(user=None):
        client = APIClient()
        if user is not None:
            from rest_framework_simplejwt.tokens import RefreshToken

            token = RefreshToken.for_user(user).access_token
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return client

    return _client


@pytest.fixture
def vendor(business):
    return Vendor.objects.create(business=business, code="V1", name="Meat Co")


@pytest.fixture
def chicken(business, vendor):
    """Boneless chicken exactly as the §5b worked example describes it."""
    return Ingredient.objects.create(
        business=business,
        code="CHK",
        name="Chicken boneless",
        unit="kg",
        rate=Decimal("360"),
        vendor=vendor,
        recipe_unit="g",
        recipe_units_per_stock_unit=Decimal("1000"),
        yield_pct=Decimal("100"),
    )


@pytest.fixture
def oil(business, vendor):
    return Ingredient.objects.create(
        business=business,
        code="OIL",
        name="Oil",
        unit="kg",
        rate=Decimal("160"),
        vendor=vendor,
        shared=True,
    )


@pytest.fixture
def worked_example(business, chicken, manager, chef):
    """The spec's worked example, recorded.

    opening 0.5, purchased 5, closing 0.8, wastage 0.3; sold 20/10/6 at 150/30/30 g
    => expected 3.48, actual_used 4.7, unexplained 0.92 kg (~26.44%)
    """
    dishes = {}
    for code, name, price, grams, plates in [
        ("D1", "Chilli chicken", "260", 150, 20),
        ("D2", "Chicken noodles", "210", 30, 10),
        ("D3", "Chicken soup", "140", 30, 6),
    ]:
        dish = Dish.objects.create(
            business=business, code=code, name=name, price=Decimal(price), ing=chicken
        )
        RecipeLine.objects.create(
            dish=dish,
            ingredient=chicken,
            qty_per_portion=Decimal(grams),
            confidence=Confidence.OWNER_STATED,
        )
        Sale.objects.create(
            business=business,
            date=DAY,
            dish=dish,
            plates=plates,
            revenue=Decimal(price) * plates,
            entered_by=manager,
        )
        dishes[code] = dish

    DailyStock.objects.create(
        business=business,
        ingredient=chicken,
        date=DAY,
        opening_qty=Decimal("0.5"),
        opened_by=chef,
        closing_qty=Decimal("0.8"),
        closed_by=chef,
    )
    Purchase.objects.create(
        business=business,
        date=DAY,
        vendor=chicken.vendor,
        ingredient=chicken,
        qty_invoiced=Decimal("5"),
        rate=Decimal("360"),
        qty_received=Decimal("5"),
    )
    Wastage.objects.create(
        business=business,
        date=DAY,
        ingredient=chicken,
        qty=Decimal("0.3"),
        reason=WastageReason.SPOILAGE,
        entered_by=chef,
    )
    return {"dishes": dishes, "start": DAY, "end": DAY + timedelta(days=6)}
