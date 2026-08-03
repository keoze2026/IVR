"""
Load the NANPA area-code → state table used for US state calling windows.

    manage.py load_npa_jurisdictions npa.csv

Expected columns: npa,state[,timezone]

Without this table US numbers resolve to the federal window only. That is a
safe default, not a correct one — states with tighter rules will be dialled to
the federal ceiling until this is loaded and the corresponding CallingWindow
rows exist.
"""

import csv

from django.core.management.base import BaseCommand, CommandError

from apps.compliance.models import NpaJurisdiction


class Command(BaseCommand):
    help = "Load NANPA area code to state mappings from a CSV file."

    def add_arguments(self, parser):
        parser.add_argument("path")
        parser.add_argument("--truncate", action="store_true",
                            help="Delete existing rows first.")

    def handle(self, *args, **options):
        path = options["path"]
        if options["truncate"]:
            NpaJurisdiction.objects.all().delete()

        rows = []
        try:
            with open(path, newline="", encoding="utf-8-sig") as fh:
                reader = csv.DictReader(fh)
                if not reader.fieldnames or "npa" not in [
                    f.strip().lower() for f in reader.fieldnames
                ]:
                    raise CommandError("CSV must have an 'npa' column")
                for row in reader:
                    row = {k.strip().lower(): (v or "").strip() for k, v in row.items()}
                    npa = row.get("npa", "")
                    if len(npa) != 3 or not npa.isdigit():
                        continue
                    rows.append(
                        NpaJurisdiction(
                            npa=npa,
                            state=row.get("state", "").upper()[:2],
                            timezone=row.get("timezone", ""),
                        )
                    )
        except FileNotFoundError as exc:
            raise CommandError(str(exc)) from exc

        NpaJurisdiction.objects.bulk_create(
            rows,
            batch_size=500,
            update_conflicts=True,
            update_fields=["state", "timezone"],
            unique_fields=["npa"],
        )
        self.stdout.write(self.style.SUCCESS(f"Loaded {len(rows)} NPA mappings"))
