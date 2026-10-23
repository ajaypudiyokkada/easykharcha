from audit.log import log_action

from .business_settings import defaults_for_new_business
from .models import (
    ONBOARDING_STEPS,
    Access,
    AccessRole,
    Business,
    BusinessSettings,
    OnboardingProgress,
)


def create_business(*, user, **fields) -> Business:
    """Creates a Business plus everything that must exist alongside it from the moment it's created
    (Owner access, one onboarding-progress row per wizard step, default settings) — shared by signup
    (name only, Step F2) and BusinessCreateView (full wizard-fallback create)."""
    business = Business.objects.create(created_by=user, **fields)
    Access.objects.create(user=user, business=business, role=AccessRole.OWNER)
    OnboardingProgress.objects.bulk_create(
        [OnboardingProgress(business=business, step=step) for step in ONBOARDING_STEPS]
    )
    BusinessSettings.objects.create(business=business, **defaults_for_new_business())
    log_action(user=user, action="business.create", business=business, name=business.name)
    return business
