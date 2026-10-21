from django.contrib import admin, messages
from django.contrib.admin.helpers import AdminForm
from django.contrib.admin.utils import unquote
from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.forms import AdminPasswordChangeForm
from django.core.exceptions import PermissionDenied
from django.http import Http404, HttpResponseRedirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.decorators import method_decorator
from django.utils.html import escape, format_html
from django.utils.translation import gettext as _
from django.views.decorators.debug import sensitive_post_parameters

from .models import User

sensitive_post_parameters_m = method_decorator(sensitive_post_parameters())


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    """Support lookup only — the raw/hashed password is never shown (excluded below). A superuser can
    still set a new password for a locked-out or forgotten-password user via the "Change password"
    link this adds, the same mechanism django.contrib.auth.admin.UserAdmin uses for the default auth
    model — reimplemented here since that admin class is tied to auth.User's own fields (username,
    etc.), which this custom, mobile-keyed User doesn't have."""

    list_display = ("mobile", "name", "email", "is_active", "is_staff", "created_at")
    list_filter = ("is_active", "is_staff", "uses_pin", "must_change_password")
    search_fields = ("mobile", "name", "email")
    ordering = ("-created_at",)
    exclude = ("password",)
    readonly_fields = (
        "created_at",
        "consent_at",
        "consent_version",
        "mobile_verified_at",
        "last_login",
        "password_change_link",
    )
    change_password_form = AdminPasswordChangeForm
    change_user_password_template = None  # default: admin/auth/user/change_password.html

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.display(description="Password")
    def password_change_link(self, obj):
        if not obj.pk:
            return "—"
        url = reverse(
            f"admin:{obj._meta.app_label}_{obj._meta.model_name}_password", args=(obj.pk,)
        )
        return format_html('<a href="{}">Change password</a>', url)

    def get_urls(self):
        return [
            path(
                "<id>/password/",
                self.admin_site.admin_view(self.user_change_password),
                name=f"{self.model._meta.app_label}_{self.model._meta.model_name}_password",
            ),
        ] + super().get_urls()

    @sensitive_post_parameters_m
    def user_change_password(self, request, id, form_url=""):
        user = self.get_object(request, unquote(id))
        if not self.has_change_permission(request, user):
            raise PermissionDenied
        if user is None:
            raise Http404(_("User not found"))

        if request.method == "POST":
            form = self.change_password_form(user, request.POST)
            if form.is_valid():
                form.save()
                change_message = self.construct_change_message(request, form, None)
                self.log_change(request, user, change_message)
                messages.success(request, _("Password changed successfully."))
                update_session_auth_hash(request, form.user)
                return HttpResponseRedirect(
                    reverse(
                        f"{self.admin_site.name}:{user._meta.app_label}_{user._meta.model_name}_change",
                        args=(user.pk,),
                    )
                )
        else:
            form = self.change_password_form(user)

        fieldsets = [(None, {"fields": list(form.base_fields)})]
        admin_form = AdminForm(form, fieldsets, {})

        context = {
            "title": _("Change password: %s") % escape(user.get_username()),
            "adminForm": admin_form,
            "form_url": form_url,
            "form": form,
            "is_popup": "_popup" in request.POST or "_popup" in request.GET,
            "add": True,
            "change": False,
            "has_delete_permission": False,
            "has_change_permission": True,
            "has_absolute_url": False,
            "opts": self.model._meta,
            "original": user,
            "save_as": False,
            "show_save": True,
            **self.admin_site.each_context(request),
        }
        request.current_app = self.admin_site.name
        return TemplateResponse(
            request,
            self.change_user_password_template or "admin/auth/user/change_password.html",
            context,
        )
