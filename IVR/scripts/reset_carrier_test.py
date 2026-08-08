#!/usr/bin/env python
"""
Put the carrier-test campaign back to a dialable state.

A one-contact campaign with max_attempts=1 completes after a single attempt,
successful or not, so every re-test needs the queue row and the campaign reset.
This is a test fixture, not an operation anyone should run against a real
campaign — resetting attempt counts is exactly how a contact gets called more
often than the retry policy allows.

    python scripts/reset_carrier_test.py --campaign <uuid>

Optionally clears the opt-out recorded by a previous press-9, so the
suppression gate does not (correctly) refuse to dial the same number twice:

    python scripts/reset_carrier_test.py --campaign <uuid> --clear-optout
"""

import argparse
import os
import sys

import django

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
django.setup()

from django.core.cache import cache  # noqa: E402

from apps.campaigns.models import Campaign, CampaignContact  # noqa: E402
from apps.common.utils import phone_hash  # noqa: E402
from apps.compliance.models import DNCEntry  # noqa: E402
from apps.dialer.limits import campaign_semaphore  # noqa: E402
from apps.telephony.models import CallLog  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--campaign", required=True)
    ap.add_argument("--clear-optout", action="store_true")
    ap.add_argument("--keep-calls", action="store_true",
                    help="keep previous CallLog rows for inspection")
    a = ap.parse_args()

    c = Campaign.objects.unscoped().get(pk=a.campaign)
    org = c.organization

    sem = campaign_semaphore(c)
    before = sem.live()
    sem.clear()
    print(f"  channels     {before} -> {sem.live()}")

    rows = CampaignContact.objects.unscoped().filter(campaign=c)
    n = rows.update(state="pending", attempts=0, last_attempt_at=None,
                    next_attempt_at=None, final_disposition="", claimed_at=None)
    print(f"  queue rows   {n} reset to pending")

    if not a.keep_calls:
        deleted, _ = CallLog.objects.unscoped().filter(campaign=c).delete()
        print(f"  call logs    {deleted} deleted")

    if a.clear_optout:
        phones = [p for p in rows.values_list("contact__phone_e164", flat=True) if p]
        for p in phones:
            h = phone_hash(p)
            d, _ = DNCEntry.objects.unscoped().filter(
                organization=org, phone_hash=h).delete()
            # The pre-dial gate reads a cached suppression decision; deleting
            # the row without dropping the key leaves the number blocked.
            cache.delete(f"{org.id}:{h}")
            cache.delete(f"dnc:{org.id}:{h}")
            print(f"  opt-out      {p}: {d} row(s) deleted, cache dropped")

    Campaign.objects.unscoped().filter(pk=c.pk).update(
        status="draft", queue_built_at=None, started_at=None,
        completed_at=None, pause_reason="",
    )
    c.refresh_from_db()
    print(f"  campaign     status={c.status} queue_built_at={c.queue_built_at}")
    print("\n  ready. place the call with:")
    print(f"    .venv/bin/python scripts/place_test_call.py --campaign {c.pk} --confirm")
    return 0


if __name__ == "__main__":
    sys.exit(main())
