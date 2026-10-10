from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.core.validators import RegexValidator
from django.db import models

mobile_validator = RegexValidator(r"^[0-9]{10}$", "Enter exactly 10 digits.")


class UserManager(BaseUserManager):
    def create_user(self, mobile: str, name: str = "", **extra) -> "User":
        if not mobile:
            raise ValueError("A mobile number is required")
        user = self.model(mobile=mobile, name=name, **extra)
        # No login exists yet (this step is foundation only), so there is nothing to set a password
        # to — unusable() keeps the field correct without inventing auth logic ahead of schedule.
        user.set_unusable_password()
        user.save(using=self._db)
        return user


class User(AbstractBaseUser):
    """A business owner's identity. Login and password logic come in a later step."""

    mobile = models.CharField(max_length=10, unique=True, validators=[mobile_validator])
    name = models.CharField(max_length=120, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    USERNAME_FIELD = "mobile"
    REQUIRED_FIELDS = ["name"]

    objects = UserManager()

    class Meta:
        ordering = ("name", "mobile")

    def __str__(self) -> str:
        return f"{self.name or 'Unnamed'} ({self.mobile})"
