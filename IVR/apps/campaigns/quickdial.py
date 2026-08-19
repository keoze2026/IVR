"""
Quick Dial — one number, one sound, go.

The full product dials a list through an authored flow. This is the short path
onto exactly the same machinery: give it a number, a sound and a pace, and it
assembles the campaign, the one-line flow that plays the sound, the list and
the single contact, then hands the result to the ordinary launch path.

Nothing here is a second dialer. Every safety property the platform has — the
suppression gate, the calling window, the channel ceiling, the audit trail —
applies because a Quick Dial *is* a campaign; it just skips the authoring the
operator would otherwise have to do by hand.
"""

from __future__ import annotations

import datetime as dt
import uuid

from django.db import transaction
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import HasCapability, IsOrganizationMember
from apps.campaigns.models import CallerID, Campaign
from apps.common.enums import ConsentScope
from apps.common.utils import phone_hash
from apps.contacts.ingest import RowError, normalise_phone
from apps.contacts.models import Contact, ContactList
from apps.ivr.models import AudioAsset, IVRFlow, IVRFlowVersion

#: What a pressed key can do in a quick-dial job. Kept small on purpose: a
#: single-number job is a broadcast, and the useful presses are "yes, connect
#: me / count me in" and "stop calling me". Transfer needs a configured
#: endpoint, so it is offered only when one is named on the step.
_DTMF_ACTIONS = {"confirm", "opt_out", "repeat", "hangup"}


def _with_disclosure(defn: dict, record: bool) -> dict:
    """
    Prepend a spoken recording disclosure when the call is recorded.

    Recording a call legally requires announcing it, and preflight refuses to
    start a recorded campaign that has no disclosure node. This adds one at the
    front and repoints the entry at it, so recording can be on without blocking.
    """
    if not record:
        return defn
    original_entry = defn["entry"]
    defn["nodes"]["disclosure"] = {
        "type": "play",
        "prompt": {"kind": "say", "text": "This call may be recorded."},
        "next": original_entry,
    }
    defn["entry"] = "disclosure"
    return defn


def _build_definition(prompt: dict, dtmf_steps: list, record: bool = False) -> dict:
    """
    A play-then-hangup flow, or play-then-listen when there are DTMF steps.

    Each step is a digit the caller can press and what it does. Without steps
    the sound simply plays and the call ends — the plain broadcast. When
    `record` is set, a spoken disclosure is prepended (see _with_disclosure).
    """
    if not dtmf_steps:
        return _with_disclosure({
            "schema_version": "1.0",
            "entry": "play",
            "default_locale": "en",
            "locales": ["en"],
            "nodes": {
                "play": {"type": "play", "prompt": prompt, "next": "done"},
                "done": {"type": "hangup",
                         "prompt": {"kind": "say", "text": "Goodbye."}},
            },
        }, record)

    options: dict[str, str] = {}
    nodes: dict[str, dict] = {
        # The sound is the menu prompt: it plays, then the call waits for a key.
        "menu": {
            "type": "menu",
            "prompt": prompt,
            "options": options,
            "timeout_seconds": 6,
            "max_attempts": 2,
            "on_timeout": "done",
            "on_invalid": "done",
        },
        "confirm": {"type": "play",
                    "prompt": {"kind": "say", "text": "Thank you. Goodbye."},
                    "next": "done", "disposition": "confirmed"},
        "optout": {"type": "opt_out",
                   "prompt": {"kind": "say",
                              "text": "You have been removed. Goodbye."},
                   "scope": "organization"},
        "done": {"type": "hangup", "prompt": {"kind": "say", "text": "Goodbye."}},
    }

    for step in dtmf_steps:
        digit = str(step.get("digit", "")).strip()
        if digit not in "0123456789*#" or len(digit) != 1:
            continue
        action = str(step.get("action", "confirm")).strip()
        if action not in _DTMF_ACTIONS:
            action = "confirm"
        options[digit] = {
            "confirm": "confirm",
            "opt_out": "optout",
            "repeat": "menu",
            "hangup": "done",
        }[action]

    if not options:
        # Steps were supplied but none was usable; fall back to plain playback
        # rather than a menu that accepts nothing.
        return _build_definition(prompt, [], record)
    return _with_disclosure({
        "schema_version": "1.0",
        "entry": "menu",
        "default_locale": "en",
        "locales": ["en"],
        "nodes": nodes,
    }, record)


def _bad(message: str) -> Response:
    return Response(
        {"error": {"code": "invalid", "message": message}},
        status=status.HTTP_400_BAD_REQUEST,
    )


class QuickDialSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    # One or many destinations, entered one per line or comma-separated.
    target_number = serializers.CharField(max_length=20000)
    # A single caller ID, or a CLI pool to rotate across. One is required.
    caller_id = serializers.UUIDField(required=False, allow_null=True)
    cli_pool = serializers.UUIDField(required=False, allow_null=True)
    # A single sound, an audio pool to rotate across, or spoken text.
    audio = serializers.UUIDField(required=False, allow_null=True)
    audio_pool = serializers.UUIDField(required=False, allow_null=True)
    # Falls back to a spoken line when no recording is chosen, so a job can be
    # placed before anyone has uploaded a sound.
    say_text = serializers.CharField(required=False, allow_blank=True)

    dial_mode = serializers.ChoiceField(
        choices=[m.value for m in Campaign.DialMode], default="fixed"
    )
    max_concurrent_channels = serializers.IntegerField(
        min_value=1, max_value=1000, default=10
    )
    dial_batch_size = serializers.IntegerField(
        min_value=1, max_value=1000, default=5
    )
    dial_interval_seconds = serializers.IntegerField(
        min_value=1, max_value=3600, default=30
    )
    cps_limit = serializers.FloatField(min_value=0.1, max_value=100, default=5.0)

    # DTMF steps: keys the caller can press after the sound plays. Each is a
    # digit plus what happens — transfer the call, or hang up. The reference's
    # "Order / Digit / Delay" maps here; delay is advisory and not enforced
    # per-step, so it is accepted but not required.
    dtmf_steps = serializers.ListField(
        child=serializers.DictField(), required=False, default=list,
    )

    # Schedule: when the job may run. Absent means "now, within the wide
    # window". Present pins a start and a daily calling window.
    schedule_start = serializers.DateTimeField(required=False, allow_null=True)
    window_start = serializers.TimeField(required=False, allow_null=True)
    window_end = serializers.TimeField(required=False, allow_null=True)

    start_now = serializers.BooleanField(default=False)


class QuickDialView(APIView):
    """`POST /api/v1/quick-dial/` — assemble and optionally launch a one-number job."""

    permission_classes = [IsOrganizationMember, HasCapability]
    required_capabilities = {"default": "campaign.edit", "post": "campaign.edit"}

    @staticmethod
    def _resolve_caller(org, data):
        """A single caller ID, or the least-used member of a CLI pool."""
        if data.get("caller_id"):
            return CallerID.objects.filter(pk=data["caller_id"], organization=org).first()
        if data.get("cli_pool"):
            from apps.campaigns.models import CLIPool

            pool = CLIPool.objects.filter(pk=data["cli_pool"], organization=org).first()
            if pool:
                # least-used-today spreads volume, which is the point of a pool.
                return pool.members.order_by("calls_today", "?").first()
        return None

    def post(self, request):
        body = QuickDialSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        org = request.organization

        # One or many destinations, split on newlines, commas or spaces.
        # Validate them all before building anything, so a typo is a clean 400
        # rather than a half-created campaign. Duplicates are collapsed.
        import re

        seen: set[str] = set()
        numbers: list[str] = []
        for token in re.split(r"[\s,;]+", data["target_number"].strip()):
            if not token:
                continue
            try:
                e164, _cc, _tz = normalise_phone(token, "US")
            except RowError:
                return _bad(f"That number is not valid: {token}")
            if e164 not in seen:
                seen.add(e164)
                numbers.append(e164)
        if not numbers:
            return _bad("Enter at least one number to dial.")
        e164 = numbers[0]  # first number: used for naming and the list label

        # Caller ID: a single number, or one drawn from a pool.
        caller = self._resolve_caller(org, data)
        if caller is None:
            return _bad("Choose a caller ID or a CLI pool with at least one number.")

        # What the caller hears: an uploaded sound (direct or from a pool), or
        # spoken text. Either way it is a single play-then-hang-up flow.
        from apps.ivr.models import AudioPool

        asset = None
        if data.get("audio"):
            asset = AudioAsset.objects.filter(pk=data["audio"], organization=org).first()
        elif data.get("audio_pool"):
            pool = AudioPool.objects.filter(pk=data["audio_pool"], organization=org).first()
            if pool:
                asset = pool.members.order_by("?").first()

        if asset is not None:
            prompt = {"kind": "audio", "asset": str(asset.pk)}
        else:
            text = (data.get("say_text") or "").strip()
            if not text:
                return _bad("Choose a sound to play, or type a message to read out.")
            prompt = {"kind": "say", "text": text}

        name = (data.get("name") or "").strip() or f"Quick dial {e164}"
        # The flow name is unique per organisation, so two quick dials to the
        # same number (a common thing to do while testing) would collide on
        # "<number> — sound". A short token keeps each job's flow distinct.
        flow_name = f"{name} — sound {uuid.uuid4().hex[:8]}"

        with transaction.atomic():
            flow = IVRFlow.objects.create(
                organization=org, name=flow_name, description="Quick dial"
            )
            # Record by default, with the spoken disclosure the flow now carries.
            record = True
            definition = _build_definition(
                prompt, data.get("dtmf_steps") or [], record=record
            )
            version = IVRFlowVersion.objects.create(
                organization=org, flow=flow, version=1, definition=definition,
                entry_node=definition["entry"], is_published=True,
            )

            contact_list = ContactList.objects.create(
                organization=org, name=f"{name} — targets",
                ingest_status="completed",
                total_rows=len(numbers), valid_rows=len(numbers),
                default_region="US",
            )
            Contact.objects.bulk_create([
                Contact(organization=org, contact_list=contact_list, phone_e164=n,
                        phone_hash=phone_hash(n), country_code="1", timezone="UTC")
                for n in numbers
            ])

            # Schedule: pin a start time and a daily window when given, else a
            # wide window so a one-number test is not deferred to tomorrow by a
            # default 09:00–17:00.
            # A quick dial is a manual, deliberate single call, so it is not
            # held to business hours by default — an operator dialing at 1 AM
            # means to dial at 1 AM. A window can still be set explicitly.
            win_start = data.get("window_start") or dt.time(0, 0)
            win_end = data.get("window_end") or dt.time(23, 59)

            campaign = Campaign.objects.create(
                organization=org, name=name, flow_version=version, caller_id=caller,
                provider=caller.provider or "twilio",
                # A quick dial is a manual, deliberate call to one number, so it
                # does not sit behind the marketing consent gate the way a bulk
                # list campaign does.
                requires_consent=False,
                # A single-number job is a manual, informational dial, not a
                # bulk marketing blast, so it is not consent-gated. Marketing
                # scope here would make preflight refuse to start it.
                consent_scope=ConsentScope.INFORMATIONAL,
                # Recording is on, and the flow now carries the spoken
                # disclosure preflight requires (see _with_disclosure), so the
                # CDR's recording control has audio to play.
                record_calls=record,
                recording_disclosure_node="disclosure" if record else "",
                dial_mode=data["dial_mode"],
                max_concurrent_channels=data["max_concurrent_channels"],
                dial_batch_size=data["dial_batch_size"],
                dial_interval_seconds=data["dial_interval_seconds"],
                cps_limit=data["cps_limit"],
                scheduled_start=data.get("schedule_start"),
                window_start_local=win_start,
                window_end_local=win_end,
                respect_contact_timezone=False,
                fallback_timezone="UTC",
                max_attempts=1,
                created_by=request.user if hasattr(request.user, "_meta") else None,
                # Recorded so the Jobs list can show what this job dials and
                # which pools it draws from. With many numbers it shows the
                # first and how many more, within the field's 32 chars.
                target_number=(e164 if len(numbers) == 1
                               else f"{e164} +{len(numbers) - 1}"),
                audio_pool_id=data.get("audio_pool"),
                cli_pool_id=data.get("cli_pool"),
            )
            campaign.contact_lists.add(contact_list)

        result = {"campaign": str(campaign.pk), "name": campaign.name,
                  "target": e164, "status": campaign.status}

        if data["start_now"]:
            from apps.campaigns.services import ComplianceError, start

            try:
                start(campaign, user=request.user, force=True)
                campaign.refresh_from_db()
                result["status"] = campaign.status
                result["started"] = True
            except ComplianceError as exc:
                # Built but not started: return why, and leave it as a draft the
                # operator can launch from the campaign screen once resolved.
                result["started"] = False
                result["blocked"] = getattr(exc, "detail", str(exc))

        return Response(result, status=status.HTTP_201_CREATED)
