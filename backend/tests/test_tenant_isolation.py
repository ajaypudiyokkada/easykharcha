"""Non-negotiable #1 — a user at tenant A cannot see or touch tenant B's data, at any endpoint."""

from decimal import Decimal

import pytest
from django.urls import reverse

from accounts.models import Access
from core.roles import Role
from inventory.models import Dish, Ingredient, Vendor
from tenants.models import Business

pytestmark = pytest.mark.django_db


@pytest.fixture
def rival(other_business, make_user):
    """A fully populated second tenant, and a manager who belongs only to it."""
    vendor = Vendor.objects.create(business=other_business, code="RV", name="Rival Supply")
    ingredient = Ingredient.objects.create(
        business=other_business,
        code="RI",
        name="Rival chicken",
        unit="kg",
        rate=Decimal("300"),
        vendor=vendor,
    )
    dish = Dish.objects.create(
        business=other_business, code="RD", name="Rival dish", price=Decimal("100"), ing=ingredient
    )
    user = make_user("9200000001", "Rival Manager", Role.MANAGER, other_business)
    return {
        "business": other_business,
        "vendor": vendor,
        "ingredient": ingredient,
        "dish": dish,
        "user": user,
    }


#: Every tenant-scoped GET endpoint. Adding an endpoint without adding it here is the bug this guards.
TENANT_GET_ENDPOINTS = [
    "vendor-list",
    "ingredient-list",
    "dish-list",
    "wastage-list",
    "purchase-list",
    "sale-list",
    "request-list",
    "sales-import-list",
    "recipe-line-list",
]
TENANT_GET_PATHS = [
    "/api/tenants/{id}/bootstrap",
    "/api/tenants/{id}/settings",
    "/api/tenants/{id}/home",
    "/api/tenants/{id}/stock",
    "/api/tenants/{id}/recent",
    "/api/tenants/{id}/report",
    "/api/tenants/{id}/variance",
    "/api/tenants/{id}/trends",
    "/api/tenants/{id}/alerts",
    "/api/tenants/{id}/audit",
    "/api/tenants/{id}/access",
    "/api/tenants/{id}/day/2026-03-02",
]


@pytest.mark.parametrize("name", TENANT_GET_ENDPOINTS)
def test_router_endpoints_reject_other_tenants(api, manager, rival, name):
    url = reverse(name, kwargs={"tenant_id": rival["business"].id})
    response = api(manager).get(url)
    assert response.status_code == 404, f"{name} leaked tenant {rival['business'].id}"


@pytest.mark.parametrize("path", TENANT_GET_PATHS)
def test_detail_endpoints_reject_other_tenants(api, manager, rival, path):
    response = api(manager).get(path.format(id=rival["business"].id))
    assert response.status_code == 404, f"{path} leaked tenant {rival['business'].id}"


def test_404_not_403_so_tenant_ids_cannot_be_probed(api, manager, rival):
    """A non-existent tenant and a forbidden one must be indistinguishable."""
    forbidden = api(manager).get(f"/api/tenants/{rival['business'].id}/bootstrap")
    missing = api(manager).get("/api/tenants/999999/bootstrap")
    assert forbidden.status_code == missing.status_code == 404


def test_cannot_write_into_another_tenant(api, manager, rival):
    response = api(manager).post(
        reverse("ingredient-list", kwargs={"tenant_id": rival["business"].id}),
        {"code": "X", "name": "Smuggled", "unit": "kg", "rate": "10"},
    )
    assert response.status_code == 404
    assert not Ingredient.objects.filter(code="X").exists()


def test_cannot_reference_another_tenants_ingredient(api, manager, business, rival):
    """The dangerous case: a valid request to *my* tenant that points at *their* row id."""
    response = api(manager).post(
        reverse("wastage-list", kwargs={"tenant_id": business.id}),
        {
            "date": "2026-03-02",
            "ingredient": rival["ingredient"].id,
            "qty": "1",
            "reason": "spoilage",
        },
    )
    assert response.status_code == 400
    assert "ingredient" in response.data["error"]["detail"]


def test_cannot_correct_another_tenants_entry(api, owner, rival, business, chicken):
    """Even an Owner's generic correction endpoint is tenant-bound."""
    from inventory.models import Wastage

    theirs = Wastage.objects.create(
        business=rival["business"],
        date="2026-03-02",
        ingredient=rival["ingredient"],
        qty=Decimal("1"),
        reason="spoilage",
    )
    response = api(owner).patch(
        f"/api/tenants/{business.id}/entries/wastage/{theirs.id}", {"qty": "99"}
    )
    assert response.status_code == 404
    theirs.refresh_from_db()
    assert theirs.qty == Decimal("1")


def test_my_tenants_lists_only_mine(api, manager, business, rival):
    response = api(manager).get("/api/tenants/mine")
    assert response.status_code == 200
    assert [row["id"] for row in response.data] == [business.id]


def test_super_admin_reaches_every_tenant(api, superadmin, business, rival):
    assert api(superadmin).get(f"/api/tenants/{business.id}/bootstrap").status_code == 200
    assert api(superadmin).get(f"/api/tenants/{rival['business'].id}/bootstrap").status_code == 200


def test_inactive_tenant_is_unreachable(api, manager, business):
    business.status = "inactive"
    business.save(update_fields=["status"])
    assert api(manager).get(f"/api/tenants/{business.id}/bootstrap").status_code == 404


def test_deactivated_user_loses_access_immediately(api, manager, business):
    client = api(manager)
    assert client.get(f"/api/tenants/{business.id}/bootstrap").status_code == 200
    manager.active = False
    manager.save(update_fields=["active"])
    # Same token, still unexpired — access must already be gone.
    assert client.get(f"/api/tenants/{business.id}/bootstrap").status_code == 401


def test_revoked_grant_takes_effect_without_a_new_token(api, manager, business):
    """Non-negotiable #3: the role is read from Access per request, never cached in the token."""
    client = api(manager)
    assert client.get(f"/api/tenants/{business.id}/bootstrap").status_code == 200
    Access.objects.filter(user=manager, business=business).update(active=False)
    assert client.get(f"/api/tenants/{business.id}/bootstrap").status_code == 404


def test_role_change_takes_effect_without_a_new_token(api, manager, business):
    client = api(manager)
    report_url = f"/api/tenants/{business.id}/report"
    assert client.get(report_url).status_code == 403  # Manager cannot see reports

    Access.objects.filter(user=manager, business=business).update(role=Role.OWNER)
    assert client.get(report_url).status_code == 200  # same token, new role


def test_new_tenant_is_not_auto_created_for_a_first_login(api, make_user):
    """§2: there is no setup wizard. A user with no grants gets a clear refusal, not a tenant."""
    from accounts.models import User

    orphan = User.objects.create_user(phone="9300000001", name="Nobody", pin="1234")
    response = api().post("/api/auth/login", {"phone": orphan.phone, "pin": "1234"})
    assert response.status_code == 403
    assert response.data["error"]["code"] == "no_access"
    assert Business.objects.count() == 0
