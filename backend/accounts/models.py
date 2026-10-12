from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.core.validators import RegexValidator
from django.db import models
from django.utils import timezone

mobile_validator = RegexValidator(r"^[6-9][0-9]{9}$", "Enter a 10-digit mobile number.")


class UserManager(BaseUserManager):
    def create_user(
        self, mobile: str, name: str = "", password: str | None = None, **extra
    ) -> "User":
        if not mobile:
            raise ValueError("A mobile number is required")
        user = self.model(mobile=mobile, name=name, **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user


class User(AbstractBaseUser):
    """A business owner's identity."""

    mobile = models.CharField(max_length=10, unique=True, validators=[mobile_validator])
    name = models.CharField(max_length=120, blank=True)
    email = models.EmailField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # Consent (signup requires consent=true; the version comes from settings.CONSENT_VERSION so a
    # later change to the consent text can be told apart from what an existing user actually agreed to).
    consent_at = models.DateTimeField(null=True, blank=True)
    consent_version = models.CharField(max_length=20, blank=True)

    # Set once OTP verification exists (Step 3 only adds the OtpProvider interface, not the flow) —
    # stays null for every user until that later step.
    mobile_verified_at = models.DateTimeField(null=True, blank=True)

    # Login lockout.
    failed_login_count = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)

    # Attribution, captured once at signup.
    utm_source = models.CharField(max_length=120, blank=True)
    utm_medium = models.CharField(max_length=120, blank=True)
    utm_campaign = models.CharField(max_length=120, blank=True)

    # Team members added by an Owner (Step 7). A Manager's secret is a temporary password — this
    # just records that it still needs changing; nothing enforces it yet. A Helper/Head chef's
    # secret is a PIN instead, stored exactly like a password (same hasher, same check_password()),
    # so login doesn't need to know or care which kind a given user has.
    must_change_password = models.BooleanField(default=False)
    uses_pin = models.BooleanField(default=False)

    USERNAME_FIELD = "mobile"
    REQUIRED_FIELDS = ["name"]

    objects = UserManager()

    class Meta:
        ordering = ("name", "mobile")

    def __str__(self) -> str:
        return f"{self.name or 'Unnamed'} ({self.mobile})"

    def is_locked(self) -> bool:
        return bool(self.locked_until and self.locked_until > timezone.now())
