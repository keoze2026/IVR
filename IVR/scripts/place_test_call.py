#!/usr/bin/env python
"""
Start the seeded carrier-test campaign and watch one real call end to end.

This dials a real phone and bills real money. It refuses to run unless
--confirm is passed.

What it watches, from the Tier 5 table in the README:

  channel release   the live-call sorted set must return to 0. If it does not,
                    status callbacks are being lost and every future campaign
                    slowly starves itself of channels.
  opt-out           if 9 is pressed, a DNCEntry must exist. The runtime is
                    supposed to commit it before returning the confirmation
                    prompt, so it should appear while the call is still up.
  disposition       whatever the caller actually did.

    python scripts/place_test_call.py --campaign <uuid> --confirm
"""

import argparse
import os
import sys
import time

import django

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
django.setup()

from django.conf import settings  # noqa: E402

from apps.campaigns.models import Campaign  # noqa: E402
from apps.campaigns.services import start  # noqa: E402
from apps.common.utils import phone_hash  # noqa: E402
from apps.compliance.models import DNCEntry  # noqa: E402
from apps.dialer.limits import campaign_semaphore  # noqa: E402
from apps.telephony.models import CallLog  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--campaign", required=True)
    ap.add_argument("--confirm", action="store_true",
                    help="required; without it nothing dials")
    ap.add_argument("--watch", type=int, default=180, help="seconds to watch")
    a = ap.parse_args()

    campaign = Campaign.objects.unscoped().get(pk=a.campaign)
    contacts = list(
        campaign.contact_lists.values_list("contacts__phone_e164", flat=True)
    )
    print(f"  campaign   {campaign.name}  status={campaign.status}")
    print(f"  from       {campaign.caller_id.phone_e164}")
    print(f"  to         {', '.join(c for c in contacts if c)}")
    print(f"  base url   {settings.PUBLIC_BASE_URL}")
    print(f"  cps        {campaign.cps_limit}   max_attempts={campaign.max_attempts}")

    if not settings.PUBLIC_BASE_URL.startswith("https://"):
        print("\n  REFUSING: PUBLIC_BASE_URL is not https. Every webhook will fail\n"
              "  signature verification and the call will connect to silence.")
        return 1
    if "example.com" in settings.PUBLIC_BASE_URL:
        print("\n  REFUSING: PUBLIC_BASE_URL is still the placeholder.")
        return 1

    if not a.confirm:
        print("\n  Dry run. Nothing dialled. Add --confirm to place the call.")
        return 0

    sem = campaign_semaphore(campaign)
    print(f"\n  live channels before: {sem.live()}")

    campaign = start(campaign, force=True)  # force: preflight warnings acknowledged
    print(f"  campaign started, status={campaign.status}\n")

    seen = {}
    dnc_seen = False
    deadline = time.time() + a.watch
    while time.time() < deadline:
        for call in CallLog.objects.unscoped().filter(campaign=campaign):
            key = call.provider_call_sid or str(call.pk)
            state = (call.status, call.disposition, call.answered_by)
            if seen.get(key) != state:
                seen[key] = state
                print(f"  [{time.strftime('%H:%M:%S')}] call {key[:12]}… "
                      f"status={call.status} disposition={call.disposition or '-'} "
                      f"answered_by={call.answered_by or '-'}")
        if not dnc_seen:
            for phone in [c for c in contacts if c]:
                if DNCEntry.objects.unscoped().filter(
                    organization=campaign.organization, phone_hash=phone_hash(phone)
                ).exists():
                    dnc_seen = True
                    print(f"  [{time.strftime('%H:%M:%S')}] "
                          f"OPT-OUT recorded for {phone}")
        live = sem.live()
        if seen and all(s[0] in {"completed", "failed", "busy", "no-answer", "canceled"}
                        for s in seen.values()) and live == 0:
            break
        time.sleep(2)

    print("\n  --- result ---")
    if not seen:
        print("    NO CALL WAS PLACED. Check the pacer and dispatch worker logs.")
    for key, (status, disp, amd) in seen.items():
        print(f"    {key[:20]:22} status={status} "
              f"disposition={disp or '-'} amd={amd or '-'}")
    live = sem.live()
    print(f"    live channels after: {live}  {'OK' if live == 0 else 'LEAKED'}")
    print(f"    opt-out recorded:    {'yes' if dnc_seen else 'no (9 not pressed)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
