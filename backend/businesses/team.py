from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User, mobile_validator
from accounts.serializers import validate_password_rules
from accounts.validators import validate_pin
from audit.log import log_action

from .access import owner_access_or_403
from .exceptions import AlreadyTeamMember, CannotRemoveSelf, TeamLimitReached
from .models import PIN_ROLES, TEAM_ROLES, Access, AccessRole, Business


def mask_mobile(mobile: str) -> str:
    return "*" * max(0, len(mobile) - 4) + mobile[-4:]


def serialize_team_member(access: Access) -> dict:
    return {
        "id": access.id,
        "name": access.user.name,
        "mobile": mask_mobile(access.user.mobile),
        "role": access.role,
    }


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
        owner_access_or_403(business, request.user)
        rows = business.access.select_related("user").order_by("created_at")
        return Response([serialize_team_member(access) for access in rows])

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        owner_access_or_403(business, request.user)

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
        owner_access_or_403(business, request.user)
        access = get_object_or_404(Access, id=access_id, business=business)

        role = request.data.get("role")
        if role not in (AccessRole.MANAGER, AccessRole.HEAD_CHEF, AccessRole.HELPER):
            raise ValidationError({"role": "Choose Manager, Head chef, or Helper."})

        access.role = role
        access.save(update_fields=["role"])
        log_action(
            user=request.user,
            action="team.role_update",
            business=business,
            access_id=access.id,
            role=role,
        )
        return Response(serialize_team_member(access))

    def delete(self, request, business_id, access_id):
        business = get_object_or_404(Business, id=business_id)
        owner_access_or_403(business, request.user)
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
        access.delete()
        return Response(status=204)
