import json
from functools import lru_cache
from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from PIL import Image
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.log import jsonable, log_action

from .access import owner_access_or_403
from .business_settings import defaults_for_new_business
from .exceptions import BusinessLimitReached, InvalidLogoFile
from .models import (
    ONBOARDING_STEPS,
    SKIPPABLE_ONBOARDING_STEPS,
    Access,
    AccessRole,
    Business,
    BusinessSettings,
    OnboardingProgress,
    OnboardingStepStatus,
)
from .permissions import require_permission
from .serializers import (
    BusinessCreateSerializer,
    BusinessSerializer,
    BusinessUpdateSerializer,
    OnboardingStepSerializer,
    OnboardingUpdateSerializer,
)

LOGO_SIZE = 512
STARTER_PACKS_PATH = Path(__file__).resolve().parent / "starter_packs.json"


@lru_cache
def _load_starter_packs() -> dict:
    return json.loads(STARTER_PACKS_PATH.read_text(encoding="utf-8"))


class BusinessCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        count = Access.objects.filter(user=request.user).count()
        if count >= settings.MAX_BUSINESSES_PER_USER:
            raise BusinessLimitReached()

        serializer = BusinessCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        business = Business.objects.create(created_by=request.user, **serializer.validated_data)
        Access.objects.create(user=request.user, business=business, role=AccessRole.OWNER)
        OnboardingProgress.objects.bulk_create(
            [OnboardingProgress(business=business, step=step) for step in ONBOARDING_STEPS]
        )
        BusinessSettings.objects.create(business=business, **defaults_for_new_business())
        log_action(
            user=request.user, action="business.create", business=business, name=business.name
        )
        return Response(BusinessSerializer(business, context={"request": request}).data, status=201)


class BusinessUpdateView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "business.manage")

        serializer = BusinessUpdateSerializer(business, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        # Only real model fields — "dismiss_checklist" is a write-only virtual field with no
        # matching attribute on Business, so it's naturally excluded from both snapshots.
        changed = [f for f in serializer.validated_data if hasattr(business, f)]
        before = {f: jsonable(getattr(business, f)) for f in changed}
        serializer.save()
        after = {f: jsonable(getattr(business, f)) for f in changed}
        log_action(
            user=request.user,
            action="business.update",
            business=business,
            before=before,
            after=after,
        )
        return Response(BusinessSerializer(business, context={"request": request}).data)


class BusinessLogoView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        owner_access_or_403(business, request.user)

        upload = request.FILES.get("logo")
        if not upload:
            raise ValidationError({"logo": "Choose a PNG or JPG file."})
        if upload.size > settings.MAX_LOGO_UPLOAD_BYTES:
            raise InvalidLogoFile()

        # The file type is checked by actually decoding it with Pillow — never by trusting the
        # filename extension or the browser-supplied Content-Type, either of which a bad actor (or
        # an honest mistake, like a renamed .svg) can get wrong. Caught broadly on purpose: anything
        # Pillow doesn't like about this upload (truncated, wrong format, a decompression-bomb sized
        # image, ...) should end in the same plain "that's not a usable file" response, not a 500.
        try:
            image = Image.open(upload)
            image.verify()
            upload.seek(0)
            image = Image.open(upload)
            if image.format not in ("PNG", "JPEG"):
                raise InvalidLogoFile()
            image.load()
        except InvalidLogoFile:
            raise
        except Exception as exc:
            raise InvalidLogoFile() from exc

        image = image.convert("RGBA" if image.format == "PNG" else "RGB")
        width, height = image.size
        side = min(width, height)
        left, top = (width - side) // 2, (height - side) // 2
        image = image.crop((left, top, left + side, top + side)).resize((LOGO_SIZE, LOGO_SIZE))

        buffer = BytesIO()
        image.save(buffer, format="PNG")
        business.logo.save(f"{business.id}.png", ContentFile(buffer.getvalue()), save=True)

        log_action(user=request.user, action="business.logo_upload", business=business)
        return Response(BusinessSerializer(business, context={"request": request}).data)


class OnboardingListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        owner_access_or_403(business, request.user)
        rows = business.onboarding_progress.all()
        return Response({"steps": OnboardingStepSerializer(rows, many=True).data})


class OnboardingStepView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, business_id, step):
        if step not in ONBOARDING_STEPS:
            raise Http404()
        business = get_object_or_404(Business, id=business_id)
        owner_access_or_403(business, request.user)

        serializer = OnboardingUpdateSerializer(data=request.data, context={"step": step})
        serializer.is_valid(raise_exception=True)
        progress, _ = OnboardingProgress.objects.update_or_create(
            business=business, step=step, defaults={"status": serializer.validated_data["status"]}
        )
        log_action(
            user=request.user,
            action="onboarding.step_update",
            business=business,
            step=step,
            status=progress.status,
        )
        return Response(OnboardingStepSerializer(progress).data)


class StarterPackView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_type):
        pack = _load_starter_packs().get(business_type)
        if pack is None:
            raise Http404()
        return Response(pack)


class OnboardingCompleteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        owner_access_or_403(business, request.user)

        progress = {p.step: p.status for p in business.onboarding_progress.all()}
        steps_1_2_done = progress.get(1) == OnboardingStepStatus.DONE and progress.get(2) == (
            OnboardingStepStatus.DONE
        )
        steps_3_6_ok = all(
            progress.get(step) in (OnboardingStepStatus.DONE, OnboardingStepStatus.SKIPPED)
            for step in SKIPPABLE_ONBOARDING_STEPS
        )
        if steps_1_2_done and steps_3_6_ok and not business.onboarding_completed_at:
            business.onboarding_completed_at = timezone.now()
            business.save(update_fields=["onboarding_completed_at"])
            log_action(user=request.user, action="onboarding.complete", business=business)

        return Response(BusinessSerializer(business, context={"request": request}).data)
