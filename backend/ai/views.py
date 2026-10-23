from uuid import uuid4

import pypdf
from django.conf import settings
from django.http import Http404
from django.shortcuts import get_object_or_404
from PIL import Image
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from businesses.models import Business
from businesses.permissions import require_permission

from . import files as ai_files
from . import limits, prompts
from .exceptions import AiDailyLimitReached, AiProviderUnavailable, AiUnavailable, InvalidMenuFile
from .jobs import process_menu_scan
from .matching import match_stock_item, normalise, stock_items_by_normalised_name, unit_family
from .models import AiRecipeCache, AiUsageKind, MenuScan, MenuScanStatus
from .provider import suggest_recipes
from .provider.errors import AiProviderCallError, AiSchemaError
from .serializers import RecipeSuggestionRequestSerializer

MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 10
MAX_IMAGES_PER_SCAN = 6
_IMAGE_FORMAT_TO_MEDIA_TYPE = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


def _validate_image(upload) -> dict:
    if upload.size > MAX_IMAGE_BYTES:
        raise InvalidMenuFile()
    # Decoded with Pillow, never trusted from the filename or browser-supplied Content-Type — same
    # approach as businesses/views.py's logo upload.
    try:
        image = Image.open(upload)
        image.verify()
        upload.seek(0)
        image = Image.open(upload)
        if image.format not in _IMAGE_FORMAT_TO_MEDIA_TYPE:
            raise InvalidMenuFile()
        image.load()
        upload.seek(0)
    except InvalidMenuFile:
        raise
    except Exception as exc:
        raise InvalidMenuFile() from exc
    return {"media_type": _IMAGE_FORMAT_TO_MEDIA_TYPE[image.format], "data": upload.read()}


def _validate_pdf(upload) -> tuple[list[dict], int]:
    if upload.size > MAX_PDF_BYTES:
        raise InvalidMenuFile()
    header = upload.read(5)
    upload.seek(0)
    if header != b"%PDF-":
        raise InvalidMenuFile()
    try:
        page_count = len(pypdf.PdfReader(upload).pages)
    except Exception as exc:
        raise InvalidMenuFile() from exc
    if not (1 <= page_count <= MAX_PDF_PAGES):
        raise InvalidMenuFile()
    upload.seek(0)
    return [{"media_type": "application/pdf", "data": upload.read()}], page_count


class MenuScanCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sellitems.manage")

        if limits.monthly_cost_cap_exceeded():
            raise AiUnavailable()

        images = request.FILES.getlist("images")
        pdf = request.FILES.get("pdf")
        if bool(images) == bool(pdf):
            raise InvalidMenuFile()

        if pdf:
            files_meta, page_count = _validate_pdf(pdf)
        else:
            if not (1 <= len(images) <= MAX_IMAGES_PER_SCAN):
                raise InvalidMenuFile()
            files_meta = [_validate_image(image) for image in images]
            page_count = len(images)

        if not limits.check_daily_scan_limit(business.id):
            raise AiDailyLimitReached()
        if not limits.check_daily_pages_limit(business.id, page_count):
            raise AiDailyLimitReached()

        scan = MenuScan.objects.create(
            business=business,
            created_by=request.user,
            page_count=page_count,
            temp_dir=uuid4().hex,
        )
        ai_files.save_temp_files(scan.temp_dir, files_meta)

        if settings.AI_FAKE:
            process_menu_scan(scan.id)
            scan.refresh_from_db()

        return Response({"id": scan.id, "status": scan.status}, status=202)


class MenuScanDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, business_id, scan_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sellitems.manage")
        scan = get_object_or_404(MenuScan, id=scan_id, business=business)

        data = {"id": scan.id, "status": scan.status}
        if scan.status == MenuScanStatus.DONE:
            data["is_menu"] = scan.result["is_menu"]
            data["sections"] = scan.result["sections"]
            if scan.result.get("incomplete"):
                data["incomplete"] = True
                data["message"] = (
                    "We may have missed some items. Please check the list or add another photo."
                )
        elif scan.status == MenuScanStatus.FAILED:
            data["error_code"] = scan.error_code
        return Response(data)


class RecipeSuggestionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, business_id):
        business = get_object_or_404(Business, id=business_id)
        require_permission(business, request.user, "sellitems.manage")

        serializer = RecipeSuggestionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        dish_names = self._requested_dish_names(business, serializer.validated_data)

        if limits.monthly_cost_cap_exceeded():
            raise AiUnavailable()
        if not limits.check_daily_recipe_limit(business.id, len(dish_names)):
            raise AiDailyLimitReached()

        stock_by_norm = stock_items_by_normalised_name(business)
        suggestions_by_norm = self._cached_suggestions(business, dish_names)

        to_call = [name for name in dish_names if normalise(name) not in suggestions_by_norm]
        if to_call:
            stock_items = [(name, unit_family(unit)) for _id, name, unit in stock_by_norm.values()]
            try:
                result = suggest_recipes(to_call, business.business_type, stock_items)
            except (AiProviderCallError, AiSchemaError) as exc:
                raise AiProviderUnavailable() from exc

            limits.record_usage(
                business=business,
                kind=AiUsageKind.RECIPE_SUGGESTION,
                model=result.model,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
            )
            for dish in result.data["dishes"]:
                key = normalise(dish["dish_name"])
                suggestions_by_norm[key] = dish
                AiRecipeCache.objects.update_or_create(
                    dish_name_normalised=key,
                    business_type=business.business_type,
                    prompt_version=prompts.RECIPE_PROMPT_VERSION,
                    defaults={"result": dish},
                )

        return Response(
            {"dishes": self._build_response(dish_names, suggestions_by_norm, stock_by_norm)}
        )

    def _requested_dish_names(self, business, validated_data) -> list[str]:
        dish_ids = validated_data.get("dish_ids")
        if dish_ids:
            items = list(business.sell_items.filter(id__in=dish_ids).values_list("id", "name"))
            if len(items) != len(set(dish_ids)):
                raise Http404()
            return [name for _id, name in items]
        return [row["name"] for row in validated_data["dishes"]]

    def _cached_suggestions(self, business, dish_names: list[str]) -> dict:
        keys = {normalise(name) for name in dish_names}
        rows = AiRecipeCache.objects.filter(
            dish_name_normalised__in=keys,
            business_type=business.business_type,
            prompt_version=prompts.RECIPE_PROMPT_VERSION,
        )
        return {row.dish_name_normalised: row.result for row in rows}

    def _ingredient_rows(self, ingredients: list[dict], stock_by_norm) -> list[dict]:
        rows = []
        for ingredient in ingredients:
            match = match_stock_item(stock_by_norm, ingredient.get("matched_stock_name"))
            rows.append(
                {
                    "name": ingredient["name"],
                    "amount": ingredient["amount"],
                    "unit": ingredient["unit"],
                    "role": ingredient["role"],
                    "confidence": ingredient["confidence"],
                    "matched_stock_item_id": match[0] if match else None,
                    "suggested_group": "",
                    "suggested_unit": ingredient["unit"] if not match else "",
                }
            )
        return rows

    def _build_response(self, dish_names, suggestions_by_norm, stock_by_norm) -> list[dict]:
        response = []
        for name in dish_names:
            suggestion = suggestions_by_norm.get(
                normalise(name), {"portion_label": "", "ingredients": [], "minor_ingredients": []}
            )
            response.append(
                {
                    "dish_name": name,
                    "portion_label": suggestion.get("portion_label", ""),
                    "ingredients": self._ingredient_rows(
                        suggestion.get("ingredients", []), stock_by_norm
                    ),
                    "minor_ingredients": self._ingredient_rows(
                        suggestion.get("minor_ingredients", []), stock_by_norm
                    ),
                }
            )
        return response
