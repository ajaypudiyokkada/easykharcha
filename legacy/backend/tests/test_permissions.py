"""Non-negotiable #2 (create vs edit/delete) and the Super Admin guards."""

from decimal import Decimal

import pytest
from django.urls import reverse

from accounts.models import Access, User
from accounts.services import active_super_admin_count
from audit.models import AuditLog
from core.roles import CAPABILITIES, Capability, Role, can
from inventory.models import Wastage

pytestmark = pytest.mark.django_db


class TestCapabilityMatrix:
    """Mirrors the table in docs/product.md §1. If the spec changes, this test should fail first."""

    @pytest.mark.parametrize(
        "role", [Role.STAFF, Role.HEAD_CHEF, Role.MANAGER, Role.OWNER, Role.SUPER_ADMIN]
    )
    def test_everyone_can_add_wastage(self, role):
        assert can(role, Capability.WASTAGE_ADD)

    @pytest.mark.parametrize("role", [Role.STAFF])
    def test_staff_cannot_capture_stock(self, role):
        assert not can(role, Capability.STOCK_CAPTURE)

    def test_manager_cannot_raise_a_request_but_the_chef_can(self):
        """The one non-monotonic row: a Manager outranks a Head Chef yet cannot raise a request."""
        assert can(Role.HEAD_CHEF, Capability.REQUEST_RAISE)
        assert not can(Role.MANAGER, Capability.REQUEST_RAISE)
        assert can(Role.OWNER, Capability.REQUEST_RAISE)

    def test_chef_cannot_record_sales(self):
        """§1b segregation: whoever counts the stock does not also report the sales."""
        assert not can(Role.HEAD_CHEF, Capability.SALES_RECORD)
        assert can(Role.MANAGER, Capability.SALES_RECORD)

    def test_manager_adds_config_but_only_owner_edits_it(self):
        assert can(Role.MANAGER, Capability.CONFIG_ADD)
        assert not can(Role.MANAGER, Capability.CONFIG_EDIT)
        assert can(Role.OWNER, Capability.CONFIG_EDIT)

    def test_only_super_admin_grants_super_admin(self):
        assert CAPABILITIES[Capability.GRANT_SUPER_ADMIN] == frozenset({Role.SUPER_ADMIN})

    def test_unknown_capability_denies(self):
        assert not can(Role.SUPER_ADMIN, "capability.that.does.not.exist")


class TestCreateVersusEdit:
    def test_staff_can_create_wastage(self, api, staff, business, chicken):
        response = api(staff).post(
            reverse("wastage-list", kwargs={"tenant_id": business.id}),
            {"date": "2026-03-02", "ingredient": chicken.id, "qty": "1.5", "reason": "spoilage"},
        )
        assert response.status_code == 201

    def test_staff_cannot_edit_their_own_entry(self, api, staff, business, chicken):
        entry = Wastage.objects.create(
            business=business,
            date="2026-03-02",
            ingredient=chicken,
            qty=Decimal("1"),
            reason="spoilage",
            entered_by=staff,
        )
        url = reverse("wastage-detail", kwargs={"tenant_id": business.id, "pk": entry.id})
        assert api(staff).patch(url, {"qty": "2"}).status_code == 403
        assert api(staff).delete(url).status_code == 403
        entry.refresh_from_db()
        assert entry.qty == Decimal("1")

    def test_manager_cannot_edit_entries_either(self, api, manager, business, chicken):
        entry = Wastage.objects.create(
            business=business,
            date="2026-03-02",
            ingredient=chicken,
            qty=Decimal("1"),
            reason="spoilage",
        )
        url = reverse("wastage-detail", kwargs={"tenant_id": business.id, "pk": entry.id})
        assert api(manager).patch(url, {"qty": "2"}).status_code == 403

    def test_owner_can_edit_and_it_is_audited(self, api, owner, business, chicken):
        entry = Wastage.objects.create(
            business=business,
            date="2026-03-02",
            ingredient=chicken,
            qty=Decimal("1"),
            reason="spoilage",
        )
        url = reverse("wastage-detail", kwargs={"tenant_id": business.id, "pk": entry.id})
        response = api(owner).patch(url, {"qty": "2.5"})
        assert response.status_code == 200

        log = AuditLog.objects.filter(action="wastage.update").first()
        assert log is not None
        assert log.detail["changed"]["qty"] == {"from": "1.000", "to": "2.500"}

    def test_delete_records_the_previous_values(self, api, owner, business, chicken):
        entry = Wastage.objects.create(
            business=business,
            date="2026-03-02",
            ingredient=chicken,
            qty=Decimal("3"),
            reason="spoilage",
        )
        url = reverse("wastage-detail", kwargs={"tenant_id": business.id, "pk": entry.id})
        assert api(owner).delete(url).status_code == 204

        log = AuditLog.objects.filter(action="wastage.delete").first()
        assert log.detail["before"]["qty"] == "3.000"

    def test_manager_adds_an_ingredient_but_cannot_change_its_price(
        self, api, manager, business, chicken
    ):
        create = api(manager).post(
            reverse("ingredient-list", kwargs={"tenant_id": business.id}),
            {"code": "NEW", "name": "New thing", "unit": "kg", "rate": "100"},
        )
        assert create.status_code == 201

        edit = api(manager).patch(
            reverse("ingredient-detail", kwargs={"tenant_id": business.id, "pk": chicken.id}),
            {"rate": "1"},
        )
        assert edit.status_code == 403
        chicken.refresh_from_db()
        assert chicken.rate == Decimal("360")


class TestSuperAdminGuards:
    def test_owner_cannot_grant_super_admin(self, api, owner, business):
        response = api(owner).post(
            f"/api/tenants/{business.id}/access",
            {"phone": "9400000001", "name": "Candidate", "role": "super_admin", "pin": "1234"},
        )
        assert response.status_code == 400
        assert response.data["error"]["code"] == "super_admin_required"

    def test_super_admin_can_promote_another(self, api, superadmin, business):
        response = api(superadmin).post(
            f"/api/tenants/{business.id}/access",
            {"phone": "9400000002", "name": "Second SA", "role": "super_admin", "pin": "1234"},
        )
        assert response.status_code == 201
        assert active_super_admin_count() == 2

    def test_the_last_super_admin_cannot_be_demoted(self, api, superadmin, business):
        grant = Access.objects.get(user=superadmin, business__isnull=True)
        response = api(superadmin).patch(
            f"/api/tenants/{business.id}/access/{grant.id}", {"role": "owner"}
        )
        assert response.status_code == 400
        assert response.data["error"]["code"] == "last_super_admin"
        assert active_super_admin_count() == 1

    def test_demotion_is_allowed_once_a_second_super_admin_exists(
        self, api, superadmin, business, make_user
    ):
        second = make_user("9400000003", "Second SA", Role.SUPER_ADMIN, None)
        grant = Access.objects.get(user=superadmin, business__isnull=True)
        response = api(second).patch(
            f"/api/tenants/{business.id}/access/{grant.id}", {"active": False}
        )
        assert response.status_code == 200
        assert active_super_admin_count() == 1

    def test_a_deactivated_super_admin_does_not_count(self, superadmin):
        Access.objects.filter(user=superadmin).update(active=False)
        assert active_super_admin_count() == 0


class TestStaffManagement:
    def test_new_staff_must_change_their_starting_pin(self, api, owner, business):
        response = api(owner).post(
            f"/api/tenants/{business.id}/access",
            {"phone": "9500000001", "name": "New Cook", "role": "head_chef", "pin": "1111"},
        )
        assert response.status_code == 201
        user = User.objects.get(phone="9500000001")
        assert user.must_change_pin is True

    def test_a_new_phone_number_needs_a_starting_pin(self, api, owner, business):
        response = api(owner).post(
            f"/api/tenants/{business.id}/access",
            {"phone": "9500000002", "name": "No PIN", "role": "staff"},
        )
        assert response.status_code == 400
        assert response.data["error"]["code"] == "pin_required"

    def test_manager_cannot_manage_staff(self, api, manager, business):
        response = api(manager).get(f"/api/tenants/{business.id}/access")
        assert response.status_code == 403

    def test_pins_never_reach_the_audit_log(self, api, owner, business):
        api(owner).post(
            f"/api/tenants/{business.id}/access",
            {"phone": "9500000003", "name": "Cook", "role": "staff", "pin": "9876"},
        )
        blob = "".join(str(log.detail) for log in AuditLog.objects.all())
        assert "9876" not in blob
        assert "pin" not in blob.lower()
