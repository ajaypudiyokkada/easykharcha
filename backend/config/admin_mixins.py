"""Shared by the read-only admin registrations: counts, purchases, sales, wastage are create-only
ledger data by design, and the audit log is append-only — none of them get an add/change/delete
form in the admin, only search and viewing. See docs/MAP.md's admin section."""


class ReadOnlyAdminMixin:
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class ReadOnlyInlineMixin:
    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class SuperuserOnlyAdminMixin:
    """Hides this model from the admin entirely (list + module index) for staff who aren't a
    superuser — for data more sensitive than the general platform-staff lookups, e.g. AI cost/usage."""

    def has_module_permission(self, request):
        return request.user.is_superuser

    def has_view_permission(self, request, obj=None):
        return request.user.is_superuser
