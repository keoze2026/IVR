#!/usr/bin/env python
"""
Seed the minimal tenant needed for the Tier 5 carrier loop.

Deliberately small, per the README: one contact, cps_limit=0.1, max_attempts=1.
The point is to prove the path works, not to move volume.

Everything goes through the real service layer — create_version/publish_version
and campaigns.services.preflight — so publishing actually runs the validator and
preflight actually runs the gates. Building the rows straight with the ORM would
prove the models save, which is not what is in doubt.

    python scripts/seed_carrier_test.py --to +254700392123 --from +17623779624

It stops before starting the campaign. Nothing here dials.
"""

import argparse
import os
import sys

import django

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
django.setup()

from django.utils import timezone  # noqa: E402

from apps.accounts.models import Organization, User  # noqa: E402
from apps.campaigns.models import CallerID, Campaign  # noqa: E402
from apps.campaigns.services import preflight  # noqa: E402
from apps.common.exceptions import InvalidFlowError  # noqa: E402
from apps.common.utils import phone_hash  # noqa: E402
from apps.contacts.models import ConsentRecord, Contact, ContactList  # noqa: E402
from apps.ivr.models import IVRFlow  # noqa: E402
from apps.ivr.services import create_version, publish_version  # noqa: E402

SLUG = "carrier-test"

FLOW = {
    "schema_version": "1.0",
    "entry": "greeting",
    "default_locale": "en",
    "locales": ["en"],
    "nodes": {
        "greeting": {
            "type": "play",
            "prompt": {"kind": "tts",
                       "text": "This is a system test call. No action is needed."},
            "next": "menu",
        },
        "menu": {
            "type": "menu",
            "prompt": {"kind": "tts",
                       "text": "Press 1 to confirm. Press 9 to opt out and never "
                               "be called again."},
            "options": {"1": "confirm", "9": "optout"},
            "timeout_seconds": 6,
            "max_attempts": 2,
            "on_timeout": "goodbye",
            "on_invalid": "goodbye",
        },
        "confirm": {
            "type": "play",
            "prompt": {"kind": "tts", "text": "Confirmed. Thank you."},
            "next": "goodbye",
            "disposition": "confirmed",
        },
        # The control with the most expensive failure mode. Pressing 9 must
        # write the DNC row before this prompt is returned, not after.
        "optout": {
            "type": "opt_out",
            "prompt": {"kind": "tts",
                       "text": "You have been removed. You will not be called again."},
            "scope": "organization",
        },
        "goodbye": {
            "type": "hangup",
            "prompt": {"kind": "tts", "text": "Goodbye."},
        },
    },
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", required=True, help="destination, E.164")
    ap.add_argument("--from", dest="from_", required=True, help="Twilio number, E.164")
    ap.add_argument("--consent", action="store_true", default=True,
                    help="record a consent row (default on; campaign requires it)")
    a = ap.parse_args()

    org, made = Organization.objects.get_or_create(
        slug=SLUG, defaults={"name": "Carrier Test", "is_active": True},
    )
    print(f"  organization   {org.slug} ({'created' if made else 'existing'})")

    user = User.objects.filter(organization=org).first()
    if not user:
        user = User.objects.create_user(
            username=f"{SLUG}-owner", email="ops@carrier.test",
            password=os.urandom(16).hex(), organization=org,
        )
    print(f"  owner          {user.email}")

    caller, _ = CallerID.objects.get_or_create(
        organization=org, phone_e164=a.from_,
        defaults={"friendly_name": "Carrier Test", "provider": "twilio",
                  "is_active": True},
    )
    print(f"  caller id      {caller.phone_e164}")

    flow, _ = IVRFlow.objects.get_or_create(
        organization=org, name="Carrier Test Flow",
        defaults={"description": "Minimal flow for the Tier 5 loop"},
    )
    version = flow.versions.filter(is_published=True).order_by("-version").first()
    if version:
        print(f"  flow version   v{version.version} (already published)")
    else:
        version = create_version(flow, FLOW, user=user)
        # render_prompts=False: pre-rendering uploads TTS audio to S3, and no
        # object-store credentials are configured. The renderer falls back to
        # inline <Say>, which is what we want to exercise on a first call
        # anyway — one less moving part between here and the carrier.
        try:
            publish_version(version, user=user, render_prompts=False)
        except InvalidFlowError as exc:
            print(f"  FLOW REJECTED  {exc.detail}")
            return 1
        version.refresh_from_db()
        warn = (version.validation_report or {}).get("warnings") or []
        print(f"  flow version   v{version.version} published"
              + (f", warnings={[w.get('code') for w in warn]}" if warn else ""))

    clist, _ = ContactList.objects.get_or_create(
        organization=org, name="Carrier Test List",
        defaults={"ingest_status": "completed", "default_region": "US"},
    )
    contact, made = Contact.objects.get_or_create(
        organization=org, contact_list=clist, phone_e164=a.to,
        defaults={"phone_hash": phone_hash(a.to), "first_name": "Test",
                  "country_code": a.to[1:4] if a.to.startswith("+254") else "1"},
    )
    print(f"  contact        {contact.phone_e164} ({'created' if made else 'existing'})")

    if a.consent:
        _, made = ConsentRecord.objects.get_or_create(
            organization=org, phone_e164=a.to, scope="marketing",
            defaults={
                "phone_hash": phone_hash(a.to), "source": "verbal",
                "disclosure_text": "Test consent recorded for a system test call.",
                "captured_at": timezone.now(),
            },
        )
        print(f"  consent        recorded ({'created' if made else 'existing'})")

    campaign, made = Campaign.objects.get_or_create(
        organization=org, name="Carrier Test Campaign",
        defaults={
            "flow_version": version,
            "caller_id": caller,
            "provider": "twilio",
            "requires_consent": True,
            "consent_scope": "marketing",
            # Small, slow, one attempt — the README's order of importance.
            "cps_limit": 0.1,
            "max_concurrent_channels": 1,
            "max_attempts": 1,
            "ring_timeout_seconds": 30,
            "amd_enabled": False,
            "record_calls": False,
            "respect_contact_timezone": False,
            "fallback_timezone": "Africa/Nairobi",
            "created_by": user,
        },
    )
    if made:
        campaign.contact_lists.add(clist)
    print(f"  campaign       {campaign.name} status={campaign.status} "
          f"cps={campaign.cps_limit} max_attempts={campaign.max_attempts}")

    print("\n  preflight:")
    report = preflight(campaign)
    ok = report.get("ok", report.get("passed"))
    for key in ("errors", "blockers", "warnings"):
        for item in report.get(key) or []:
            print(f"    {key[:-1]:8} {item}")
    print(f"    result   {'PASS' if ok else 'BLOCKED'}")

    print(f"\n  campaign id    {campaign.id}")
    print("  nothing has dialled. To place the call:")
    print(f"    python scripts/place_test_call.py --campaign {campaign.id}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
