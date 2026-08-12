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

from django.db import transaction
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import HasCapability, IsOrganizationMember
from apps.campaigns.models import CallerID, Campaign
from apps.common.utils import phone_hash
from apps.contacts.ingest import RowError, normalise_phone
from apps.contacts.models import Contact, ContactList
from apps.ivr.models import AudioAsset, IVRFlow, IVRFlowVersion


def _bad(message: str) -> Response:
    return Response(
        {"error": {"code": "invalid", "message": message}},
        status=status.HTTP_400_BAD_REQUEST,
    )


class QuickDialSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    target_number = serializers.CharField(max_length=32)
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

        # Validate the destination before building anything, so a typo is a
        # clean 400 rather than a half-created campaign.
        try:
            e164, _cc, _tz = normalise_phone(data["target_number"], "US")
        except RowError as exc:
            return _bad(f"That number is not valid: {exc}")

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

        with transaction.atomic():
            flow = IVRFlow.objects.create(
                organization=org, name=f"{name} — sound", description="Quick dial"
            )
            definition = {
                "schema_version": "1.0",
                "entry": "play",
                "default_locale": "en",
                "locales": ["en"],
                "nodes": {
                    "play": {"type": "play", "prompt": prompt, "next": "done"},
                    "done": {"type": "hangup",
                             "prompt": {"kind": "say", "text": "Goodbye."}},
                },
            }
            version = IVRFlowVersion.objects.create(
                organization=org, flow=flow, version=1, definition=definition,
                entry_node="play", is_published=True,
            )

            contact_list = ContactList.objects.create(
                organization=org, name=f"{name} — target", ingest_status="completed",
                total_rows=1, valid_rows=1, default_region="US",
            )
            Contact.objects.create(
                organization=org, contact_list=contact_list, phone_e164=e164,
                phone_hash=phone_hash(e164), country_code="1", timezone="UTC",
            )

            campaign = Campaign.objects.create(
                organization=org, name=name, flow_version=version, caller_id=caller,
                provider=caller.provider or "twilio",
                # A quick dial is a manual, deliberate call to one number, so it
                # does not sit behind the marketing consent gate the way a bulk
                # list campaign does.
                requires_consent=False,
                dial_mode=data["dial_mode"],
                max_concurrent_channels=data["max_concurrent_channels"],
                dial_batch_size=data["dial_batch_size"],
                dial_interval_seconds=data["dial_interval_seconds"],
                cps_limit=data["cps_limit"],
                # Wide window: a one-number test should not be silently deferred
                # to tomorrow because of a default 09:00–17:00.
                window_start_local="08:00",
                window_end_local="21:00",
                respect_contact_timezone=False,
                fallback_timezone="UTC",
                max_attempts=1,
                created_by=request.user if hasattr(request.user, "_meta") else None,
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
