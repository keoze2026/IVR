"""
Copy the recordings of earlier Telnyx calls into our own storage.

    python manage.py copy_telnyx_recordings

Safe to run again: calls that already have a stored recording are skipped.
"""

from django.core.management.base import BaseCommand

from apps.telephony.models import CallLog
from apps.telephony.tasks import copy_telnyx_recording


class Command(BaseCommand):
    help = "Copy missing Telnyx call recordings into storage."

    def handle(self, *args, **options):
        calls = (
            CallLog.objects.unscoped()
            .filter(provider="telnyx", recording_key="",
                    recording_purged_at__isnull=True)
            .exclude(recording_url="")
            .order_by("-created_at")
        )
        copied = failed = 0
        for call in calls:
            try:
                # The stored link has expired or was cut to fit the column, so
                # ask Telnyx for a current one.
                key = copy_telnyx_recording(call)
            except Exception as exc:  # report each call, then carry on
                key, reason = "", str(exc)[:200]
            else:
                reason = "Telnyx has no recording for this call"
            if key:
                CallLog.objects.unscoped().filter(pk=call.pk).update(
                    recording_key=key
                )
                copied += 1
            else:
                failed += 1
                self.stdout.write(f"  not copied {call.provider_call_sid}: {reason}")
        self.stdout.write(f"recordings copied: {copied}, not copied: {failed}")
