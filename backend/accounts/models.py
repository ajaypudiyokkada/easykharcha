from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager
from django.core.validators import RegexValidator
from django.db import models

from core.models import TimeStampedModel
from core.roles import Role

phone_validator = RegexValidator(
    r"^\+?[0-9]{7,15}$", "Enter a phone number (7–15 digits, optional leading +)."
)


class UserManager(BaseUserManager):
    def create_user(self, phone: str, name: str = "", pin: str | None = None, **extra):
        if not phone:
            raise ValueError("A phone number is required")
        user = self.model(phone=phone, name=name, **extra)
        user.set_pin(pin)
        user.save(using=self._db)
        return user

    def create_superuser(self, phone: str, name: str = "", pin: str | None = None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        return self.create_user(phone, name=name, pin=pin, **extra)


class User(AbstractBaseUser, TimeStampedModel):
    """One identity per person, however many tenants they touch (§2 of docs/product.md).

    `password` on AbstractBaseUser stores the hashed PIN; `set_pin`/`check_pin` are the names used
    everywhere in this codebase so nothing reads as if a long password were expected.
    """

    phone = models.CharField(max_length=20, unique=True, validators=[phone_validator])
    name = models.CharField(max_length=120, blank=True)
    active = models.BooleanField(default=True)
    #: Forces a PIN change on next login — set when an Owner creates or resets a staff account.
    must_change_pin = models.BooleanField(default=False)

    is_staff = models.BooleanField(
        default=False
    )  # Django admin access only, unrelated to Role.STAFF
    is_superuser = models.BooleanField(default=False)

    USERNAME_FIELD = "phone"
    REQUIRED_FIELDS = ["name"]

    objects = UserManager()

    class Meta:
        ordering = ("name", "phone")

    def __str__(self) -> str:
        return f"{self.name or 'Unnamed'} ({self.phone})"

    # -- PIN -------------------------------------------------------------------------------------
    def set_pin(self, pin: str | None) -> None:
        self.password = make_password(pin) if pin else make_password(None)

    def check_pin(self, pin: str) -> bool:
        return check_password(pin, self.password)

    @property
    def is_active(self) -> bool:
        """Django's auth machinery reads `is_active`; the product spec calls the field `active`."""
        return self.active

    def has_perm(self, perm, obj=None) -> bool:
        return self.is_superuser

    def has_module_perms(self, app_label) -> bool:
        return self.is_superuser


class Access(TimeStampedModel):
    """A (user, tenant, role) grant. `business = NULL` means a global Super Admin grant (§2)."""

    business = models.ForeignKey(
        "tenants.Business",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="accesses",
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="accesses")
    role = models.CharField(max_length=20, choices=Role.choices)
    active = models.BooleanField(default=True)

    class Meta:
        verbose_name_plural = "accesses"
        constraints = [
            models.UniqueConstraint(
                fields=["business", "user"],
                condition=models.Q(business__isnull=False),
                name="unique_access_per_tenant_user",
            ),
            models.UniqueConstraint(
                fields=["user"],
                condition=models.Q(business__isnull=True),
                name="unique_global_access_per_user",
            ),
            models.CheckConstraint(
                condition=models.Q(business__isnull=False) | models.Q(role=Role.SUPER_ADMIN),
                name="global_access_is_super_admin_only",
            ),
        ]

    def __str__(self) -> str:
        where = self.business.name if self.business else "ALL TENANTS"
        return f"{self.user.phone} — {self.role} @ {where}"
