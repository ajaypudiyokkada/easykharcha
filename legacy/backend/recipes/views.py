from django.shortcuts import get_object_or_404
from rest_framework import viewsets
from rest_framework.response import Response

from core.exceptions import BusinessRuleError
from core.permissions import IsAuthenticatedActive
from core.roles import Capability
from core.tenancy import global_super_admin_access
from core.viewsets import TenantAPIView
from inventory.models import Dish
from inventory.serializers import RecipeLineSerializer
from recipes import services
from recipes.models import CanonicalIngredient, RecipeTemplate
from recipes.serializers import (
    AdoptSerializer,
    CanonicalIngredientSerializer,
    RecipeTemplateSerializer,
)


class GlobalLibraryPermission(IsAuthenticatedActive):
    """Anyone signed in may read the global library; only a Super Admin may change it (§5d)."""

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return True
        return global_super_admin_access(request.user) is not None


class RecipeTemplateViewSet(viewsets.ModelViewSet):
    queryset = RecipeTemplate.objects.prefetch_related("lines__canonical").all()
    serializer_class = RecipeTemplateSerializer
    permission_classes = [GlobalLibraryPermission]
    filterset_fields = ["cuisine", "category"]

    def get_queryset(self):
        queryset = super().get_queryset()
        query = self.request.query_params.get("q")
        if query:
            queryset = queryset.filter(name__icontains=query)
        return queryset


class CanonicalIngredientViewSet(viewsets.ModelViewSet):
    queryset = CanonicalIngredient.objects.all()
    serializer_class = CanonicalIngredientSerializer
    permission_classes = [GlobalLibraryPermission]

    def get_queryset(self):
        queryset = super().get_queryset()
        query = self.request.query_params.get("q")
        if query:
            queryset = queryset.filter(name__icontains=query)
        return queryset


class RecipeAdoptView(TenantAPIView):
    """GET previews the mapping; POST writes the RecipeLines. Adding is Manager+ (§5b)."""

    read_capability = Capability.CONFIG_ADD
    create_capability = Capability.CONFIG_ADD

    def _dish(self, pk):
        return get_object_or_404(Dish, pk=pk, business=self.access.business)

    def get(self, request, tenant_id, pk, *args, **kwargs):
        dish = self._dish(pk)
        code = request.query_params.get("template")
        if not code:
            return Response(
                {
                    "dish": dish.name,
                    "suggestions": services.suggest_templates(self.access.business, dish),
                }
            )
        template = get_object_or_404(RecipeTemplate, code=code)
        preview = services.preview_adopt(
            self.access.business, template, request.query_params.get("size") or None
        )
        preview["dish"] = {"id": dish.id, "code": dish.code, "name": dish.name, "price": dish.price}
        return Response(preview)

    def post(self, request, tenant_id, pk, *args, **kwargs):
        dish = self._dish(pk)
        serializer = AdoptSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        template = RecipeTemplate.objects.filter(code=data["template"]).first()
        if template is None:
            raise BusinessRuleError(
                f"No recipe template with code '{data['template']}'.", code="unknown_template"
            )
        if data.get("replace") and not self.access.can(Capability.CONFIG_EDIT):
            raise BusinessRuleError(
                "Replacing an existing recipe is an Owner action. Ask an Owner, or adopt without "
                "replace to add only the missing lines.",
                code="forbidden",
            )

        result = services.adopt(
            self.access,
            dish,
            template,
            size=data.get("size") or None,
            choices=data.get("choices"),
            replace=data.get("replace", False),
        )
        context = {"access": self.access, "business": self.access.business, "request": request}
        return Response(
            {
                "created": RecipeLineSerializer(result["created"], many=True, context=context).data,
                "skipped": result["skipped"],
            }
        )
