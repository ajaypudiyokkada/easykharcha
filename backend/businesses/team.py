from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from accounts.models import User, mobile_validator
from accounts.serializers import validate_password_rules
from accounts.validators import validate_pin
from audit.log import log_action

from .exceptions import (
    AlreadyTeamMember,
    CannotChangeOwnerRole,
    CannotRemoveSelf,
    CannotResetSelf,
    TeamLimitReached,
)
from .models import PIN_ROLES, TEAM_ROLES, Access, AccessRole, Business
from .permissions import access_or_403, permissions_for, require_permission


def mask_mobile(mobile: str) -> str:
    return "*" * max(0, len(mobile) - 4) + mobile[-4:]


def serialize_team_member(access: Access) -> dict:
    return {
        "id": access.id,
        # Step 10: the Count review screen's "Remind <name>" needs this to call
        # POST counts/remind/ {type, user_id} for a team member who hasn't counted yet at all (so
        # there's no StockCount row — and no counted_by — to get it from instead).
        "user_id": access.user_id,
        "name": access.user.name,
        "mobile": mask_mobile(access.user.mobile),
        "role": access.role,
        "last_login_at": access.user.last_login.isoformat() if access.user.last_login else None,
        "added_at": access.created_at.isoformat(),
    }


def _blacklist_outstanding_tokens(user: User) -> None:
    """Logs a user out everywhere right away — simplejwt access tokens stay valid until they expire
    naturally, but every refresh token they could use to get a new one is blacklisted here."""
    for token in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=token)


def _flatten_detail(detail) -> str:
    if isinstance(detail, dict):
        for value in detail.values():
            return _flatten_detail(value)
        return "Invalid value."
    if isinstance(detail, list):
        return _flatten_detail(detail[0]) if detail else "Invalid value."
    return str(detail)


def _validate_secret(secret: str, mobile: str, name: str, uses_pin: bool) -> None:
    try:
        if uses_pin:
            validate_pin(secret)
        else:
            validate_password_rules(secret, mobile, name)
    except serializers.ValidationError as exc:
        raise serializers.ValidationError({"secret": _flatten_detail(exc.detail)}) from exc


class _MobileRoleSerializer(serializers.Serializer):
    mobile = serializers.CharField(max_length=10, validators=[mobile_validator])
    role = serializers.ChoiceField(
        choices=[AccessRole.MANAGER, AccessRole.HEAD_CHEF, AccessRole.HELPER]
    )


class TeamListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        access = access_or_403(business, request.user)
        # Owner (team.manage) and Manager (team.view) can both see the list — PATCH/DELETE/reset
        # below are team.manage only, so this is the one endpoint that accepts either permission.
        if not {"team.manage", "team.view"} & permissions_for(access.role):
            raise PermissionDenied()
        rows = business.access.select_related("user").order_by("created_at")
        return Response([serialize_team_member(access) for access in rows])

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "team.manage")

        count = business.access.filter(role__in=TEAM_ROLES).count()
        if count >= settings.MAX_TEAM_MEMBERS_PER_BUSINESS:
            raise TeamLimitReached()

        base = _MobileRoleSerializer(data=request.data)
        base.is_valid(raise_exception=True)
        mobile = base.validated_data["mobile"]
        role = base.validated_data["role"]

        existing_user = User.objects.filter(mobile=mobile).first()
        if existing_user:
            # Never touch an existing person's credential — only attach them to this business.
            if Access.objects.filter(user=existing_user, business=business).exists():
                raise AlreadyTeamMember()
            access = Access.objects.create(user=existing_user, business=business, role=role)
            log_action(
                user=request.user,
                action="team.add_existing",
                business=business,
                mobile=mask_mobile(mobile),
                role=role,
            )
            return Response(serialize_team_member(access), status=201)

        name = (request.data.get("name") or "").strip()
        if not name:
            raise ValidationError({"name": "Enter a name."})
        secret = request.data.get("secret", "")
        uses_pin = role in PIN_ROLES
        _validate_secret(secret, mobile, name, uses_pin)

        user = User.objects.create_user(
            mobile=mobile,
            name=name,
            password=secret,
            uses_pin=uses_pin,
            must_change_password=(role == AccessRole.MANAGER),
            # consent_at stays empty — this person never saw or agreed to the consent text; the
            # Owner added them, they didn't sign up themselves.
        )
        access = Access.objects.create(user=user, business=business, role=role)
        log_action(
            user=request.user,
            action="team.add_new",
            business=business,
            mobile=mask_mobile(mobile),
            role=role,
        )
        return Response(serialize_team_member(access), status=201)


class TeamMemberDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, business_id, access_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "team.manage")
        access = get_object_or_404(Access, id=access_id, business=business)

        if access.role == AccessRole.OWNER:
            raise CannotChangeOwnerRole()

        new_role = request.data.get("role")
        if new_role not in (AccessRole.MANAGER, AccessRole.HEAD_CHEF, AccessRole.HELPER):
            raise ValidationError({"role": "Choose Manager, Head chef, or Helper."})

        # Helper <-> Head chef share a PIN, so the role alone can change freely. Crossing the
        # Manager boundary either way changes which *kind* of secret the account uses (PIN vs
        # password), so a new one is required in the same request — there's no safe default to
        # fall back to.
        crosses_manager_boundary = (new_role == AccessRole.MANAGER) != (
            access.role == AccessRole.MANAGER
        )
        if crosses_manager_boundary:
            secret = request.data.get("secret", "")
            if not secret:
                raise ValidationError(
                    {"secret": "Enter a new PIN or password for this role change."}
                )
            uses_pin = new_role != AccessRole.MANAGER
            _validate_secret(secret, access.user.mobile, access.user.name, uses_pin)
            access.user.set_password(secret)
            access.user.uses_pin = uses_pin
            access.user.must_change_password = new_role == AccessRole.MANAGER
            access.user.save(update_fields=["password", "uses_pin", "must_change_password"])

        access.role = new_role
        access.save(update_fields=["role"])
        log_action(
            user=request.user,
            action="team.role_update",
            business=business,
            access_id=access.id,
            role=new_role,
        )
        return Response(serialize_team_member(access))

    def delete(self, request, business_id, access_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "team.manage")
        access = get_object_or_404(Access, id=access_id, business=business)

        if access.user_id == request.user.id and access.role == AccessRole.OWNER:
            raise CannotRemoveSelf()

        log_action(
            user=request.user,
            action="team.remove",
            business=business,
            access_id=access.id,
            role=access.role,
        )
        member_user = access.user
        access.delete()
        # Removed-member sessions are blacklisted unconditionally — simplejwt tokens aren't scoped
        # to one business, so there's no way to tell "still has an unexpired session for this
        # business" apart from any other session without forcing a sign-out either way.
        _blacklist_outstanding_tokens(member_user)
        return Response(status=204)


class TeamResetSecretView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, business_id, access_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "team.manage")
        access = get_object_or_404(Access, id=access_id, business=business)

        if access.user_id == request.user.id and access.role == AccessRole.OWNER:
            raise CannotResetSelf()

        secret = request.data.get("secret", "")
        uses_pin = access.role in PIN_ROLES
        _validate_secret(secret, access.user.mobile, access.user.name, uses_pin)

        user = access.user
        user.set_password(secret)
        user.must_change_password = access.role == AccessRole.MANAGER
        user.failed_login_count = 0
        user.locked_until = None
        user.save(
            update_fields=["password", "must_change_password", "failed_login_count", "locked_until"]
        )
        _blacklist_outstanding_tokens(user)

        log_action(
            user=request.user,
            action="team.secret_reset",
            business=business,
            access_id=access.id,
        )
        return Response(serialize_team_member(access))
