from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class TenantScopedQuerySet(models.QuerySet):
    def for_tenant(self, business):
        return self.filter(business=business)


class TenantScopedModel(TimeStampedModel):
    """Base for every operational row.

    Non-negotiable #1: the tenant FK is declared here so it cannot be forgotten on a new model, and
    `core.viewsets.TenantScopedViewSet` filters on it for every request rather than each view doing its
    own filtering.
    """

    business = models.ForeignKey(
        "tenants.Business", on_delete=models.CASCADE, related_name="%(class)ss"
    )

    objects = TenantScopedQuerySet.as_manager()

    class Meta:
        abstract = True
