"""
Create the first platform administrator.

The one command that has to be run from a terminal, once, ever. Something must
create the first account, and it cannot be created through a portal that
requires an account to reach. Every administrator after this one is created in
the portal itself.

    python manage.py create_admin --username hans --password '...'
    python manage.py create_admin --username hans          # prompts, hidden
"""

import getpass

from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import Role, User


class Command(BaseCommand):
    help = "Create the first platform administrator (full rights over the system)."

    def add_arguments(self, parser):
        parser.add_argument("--username", required=True)
        parser.add_argument("--password", default=None)
        parser.add_argument("--email", default="")
        parser.add_argument(
            "--force", action="store_true",
            help="Reset the password if this administrator already exists.",
        )

    def handle(self, *args, **options):
        username = options["username"].strip()
        password = options["password"] or getpass.getpass("Password: ")

        if len(password) < 10:
            # This account can read and delete every tenant's data. A short
            # password here is a different class of problem to a short one
            # anywhere else in the system.
            raise CommandError("Choose a password of at least 10 characters.")

        existing = User.objects.filter(username=username).first()
        if existing and not options["force"]:
            raise CommandError(
                f"'{username}' already exists. Pass --force to reset the password."
            )

        if existing:
            existing.set_password(password)
            existing.is_superuser = True
            existing.is_staff = True
            existing.is_active = True
            existing.save()
            user = existing
            what = "updated"
        else:
            user = User.objects.create_user(
                username=username,
                email=options["email"],
                password=password,
                # No organisation: a platform administrator sits above tenancy,
                # which is what lets the platform API cross it.
                organization=None,
                role=Role.OWNER,
                is_superuser=True,
                is_staff=True,
            )
            what = "created"

        self.stdout.write(self.style.SUCCESS(f"Administrator {what}: {user.username}"))
        self.stdout.write("  Sign in at /admin in the portal with this username")
        self.stdout.write("  and the password you just set.")
