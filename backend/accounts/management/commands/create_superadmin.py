"""Bootstrap the single seeded Super Admin (§2).

No credentials are hard-coded and no tenant is auto-created: the Super Admin builds the first business
through the app. Reads SUPERADMIN_PHONE / SUPERADMIN_NAME / SUPERADMIN_PIN from the environment, or
takes them as arguments.
"""

import os

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import Access, User
from core.roles import Role


class Command(BaseCommand):
    help = "Create (or reactivate) the global Super Admin account."

    def add_arguments(self, parser):
        parser.add_argument("--phone", default=os.environ.get("SUPERADMIN_PHONE"))
        parser.add_argument("--name", default=os.environ.get("SUPERADMIN_NAME", "Super Admin"))
        parser.add_argument("--pin", default=os.environ.get("SUPERADMIN_PIN"))
        parser.add_argument(
            "--reset-pin",
            action="store_true",
            help="Reset the PIN if the account already exists.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        phone = (options["phone"] or "").strip()
        pin = options["pin"]
        if not phone:
            raise CommandError("Set SUPERADMIN_PHONE or pass --phone.")
        if not pin:
            raise CommandError("Set SUPERADMIN_PIN or pass --pin.")
        if not pin.isdigit():
            raise CommandError("The PIN must be digits only.")

        user, created = User.objects.get_or_create(
            phone=phone, defaults={"name": options["name"], "active": True}
        )
        if created or options["reset_pin"]:
            user.set_pin(pin)
            user.must_change_pin = False
        user.active = True
        user.is_staff = True
        user.is_superuser = True
        user.save()

        grant, grant_created = Access.objects.get_or_create(
            user=user, business=None, defaults={"role": Role.SUPER_ADMIN, "active": True}
        )
        grant.role = Role.SUPER_ADMIN
        grant.active = True
        grant.save()

        what = "Created" if created else "Updated"
        self.stdout.write(
            self.style.SUCCESS(
                f"{what} Super Admin {user.name} ({user.phone}). "
                f"Grant {'created' if grant_created else 'already existed'}."
            )
        )
        if not created and not options["reset_pin"]:
            self.stdout.write("PIN unchanged. Pass --reset-pin to set a new one.")
