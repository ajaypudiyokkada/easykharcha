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
