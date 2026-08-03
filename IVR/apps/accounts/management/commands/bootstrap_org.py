"""
Create an organisation, an owner user and a first API key.

    manage.py bootstrap_org --name "Acme" --slug acme --email ops@acme.test

Prints the API key once. It is not recoverable afterwards — only its SHA-256 is
stored.
"""

import getpass

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import APIKey, Organization, Role, User


class Command(BaseCommand):
    help = "Create an organisation with an owner user and an API key."

    def add_arguments(self, parser):
        parser.add_argument("--name", required=True)
        parser.add_argument("--slug", required=True)
        parser.add_argument("--email", required=True)
        parser.add_argument("--username", default=None)
        parser.add_argument("--password", default=None)
        parser.add_argument("--max-cps", type=float, default=5.0)
        parser.add_argument("--max-channels", type=int, default=50)

    @transaction.atomic
    def handle(self, *args, **options):
        if Organization.objects.filter(slug=options["slug"]).exists():
            raise CommandError(f"Organisation '{options['slug']}' already exists")

        org = Organization.objects.create(
            name=options["name"],
            slug=options["slug"],
            support_email=options["email"],
            max_cps=options["max_cps"],
            max_concurrent_channels=options["max_channels"],
        )

        username = options["username"] or options["email"]
        password = options["password"] or getpass.getpass("Owner password: ")
        if not password:
            raise CommandError("A password is required")

        user = User.objects.create_user(
            username=username,
            email=options["email"],
            password=password,
            organization=org,
            role=Role.OWNER,
            is_staff=True,
        )

        _key, raw = APIKey.generate(org, "bootstrap", role=Role.OWNER,
                                    created_by=user)

        from apps.compliance.tasks import seed_default_windows

        seed_default_windows(str(org.pk))

        self.stdout.write(self.style.SUCCESS(f"Organisation {org.slug} created"))
        self.stdout.write(f"  owner:   {user.username}")
        self.stdout.write(f"  api key: {raw}")
        self.stdout.write(
            self.style.WARNING("  Store the key now — it cannot be shown again.")
        )
