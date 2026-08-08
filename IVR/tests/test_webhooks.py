"""
The carrier callback surface (spec 8.2, 9.1).

This is the only unauthenticated write path into the system. It mutates call
state, records suppressions and spends money, and the sole thing standing in
front of it is the provider signature. The README lists these as Tier 5 manual
checks because they need a carrier; the signature, dedupe, opt-out and channel
mechanics do not, and a control that is only ever verified by hand is a control
that stops being verified.

Signatures are generated here from the providers' published algorithms rather
than by calling the same helper the application verifies with, so a bug in the
implementation cannot cancel itself out.
"""

import base64
import hashlib
import hmac
import time
import urllib.parse
import uuid

import pytest

pytestmark = pytest.mark.django_db

TOKEN = "test_auth_token_not_a_real_one"  # noqa: S105
BASE_URL = "https://callbacks.test"


# ---------------------------------------------------------------------------
# Signature helpers — Twilio's and Telnyx's documented schemes, by hand.
# ---------------------------------------------------------------------------
def twilio_signature(url: str, params: dict, token: str = TOKEN) -> str:
    """HMAC-SHA1 over the URL with sorted key+value pairs appended."""
    payload = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    digest = hmac.new(token.encode(), payload.encode("utf-8"), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def telnyx_keypair():
    from nacl.signing import SigningKey

    signing_key = SigningKey.generate()
    public_b64 = base64.b64encode(bytes(signing_key.verify_key)).decode()
    return signing_key, public_b64


def telnyx_signature(signing_key, body: bytes, timestamp: str) -> str:
    signed = signing_key.sign(f"{timestamp}|".encode() + body)
    return base64.b64encode(signed.signature).decode()


@pytest.fixture
def webhook_settings(settings):
    settings.PUBLIC_BASE_URL = BASE_URL
    settings.WEBHOOK_VERIFY_SIGNATURES = True
    settings.WEBHOOK_IP_ALLOWLIST = []
    settings.TWILIO_AUTH_TOKEN = TOKEN
    return settings


def post_twilio(client, path, params, *, signature=None, url=None):
    """POST a form-encoded Twilio callback with a valid signature by default."""
    full_url = url or f"{BASE_URL}{path}"
    return client.post(
        path,
        urllib.parse.urlencode(params),
        content_type="application/x-www-form-urlencoded",
        HTTP_X_TWILIO_SIGNATURE=signature or twilio_signature(full_url, params),
    )


# ---------------------------------------------------------------------------
# Signature verification
# ---------------------------------------------------------------------------
class TestTwilioSignature:
    """"Replay a callback with a tampered body; must 403" — README, Tier 5."""

    PATH = "/webhooks/twilio/status/"

    def test_a_valid_signature_is_accepted(self, client, webhook_settings):
        params = {"CallSid": "CA" + "1" * 32, "CallStatus": "completed"}
        response = post_twilio(client, self.PATH, params)
        assert response.status_code != 403

    def test_blank_valued_parameters_are_kept_when_verifying(self, client,
                                                             webhook_settings):
        """
        Regression: a real Twilio callback carries empty-valued fields, and
        Twilio signs over them. Parsing the body with parse_qsl's default
        keep_blank_values=False dropped them, so the reconstructed signature
        never matched and every live callback 403'd — while every test using a
        hand-built payload passed, because those have no blank fields.

        Found against a real carrier, not in CI. Hence this test.
        """
        params = {
            "CallSid": "CA" + "1" * 32,
            "CallStatus": "completed",
            "CalledCity": "",
            "CalledState": "",
            "CallerName": "",
            "To": "+254700392123",
        }
        response = post_twilio(client, self.PATH, params)
        assert response.status_code != 403, (
            "blank-valued parameters were dropped before signature verification"
        )

    def test_a_tampered_body_is_rejected(self, client, webhook_settings):
        params = {"CallSid": "CA" + "1" * 32, "CallStatus": "completed"}
        signature = twilio_signature(f"{BASE_URL}{self.PATH}", params)
        # Same signature, different body — the classic replay-with-edit.
        params["CallStatus"] = "failed"
        response = post_twilio(client, self.PATH, params, signature=signature)
        assert response.status_code == 403

    def test_a_missing_signature_is_rejected(self, client, webhook_settings):
        response = client.post(
            self.PATH,
            urllib.parse.urlencode({"CallSid": "CA1", "CallStatus": "completed"}),
            content_type="application/x-www-form-urlencoded",
        )
        assert response.status_code == 403

    def test_a_signature_from_another_token_is_rejected(self, client,
                                                        webhook_settings):
        params = {"CallSid": "CA1", "CallStatus": "completed"}
        forged = twilio_signature(f"{BASE_URL}{self.PATH}", params,
                                  token="the-wrong-token")
        response = post_twilio(client, self.PATH, params, signature=forged)
        assert response.status_code == 403

    def test_a_signature_bound_to_a_different_url_is_rejected(self, client,
                                                              webhook_settings):
        """Signing covers the URL, so a callback cannot be replayed at another
        endpoint. This is also what breaks when PUBLIC_BASE_URL is wrong — the
        first thing the README tells you to check."""
        params = {"CallSid": "CA1", "CallStatus": "completed"}
        elsewhere = twilio_signature(f"{BASE_URL}/webhooks/twilio/recording/",
                                     params)
        response = post_twilio(client, self.PATH, params, signature=elsewhere)
        assert response.status_code == 403

    def test_verification_can_be_disabled_only_deliberately(self, client,
                                                            webhook_settings):
        webhook_settings.WEBHOOK_VERIFY_SIGNATURES = False
        response = client.post(
            self.PATH,
            urllib.parse.urlencode({"CallSid": "CA1", "CallStatus": "completed"}),
            content_type="application/x-www-form-urlencoded",
        )
        assert response.status_code != 403


class TestTelnyxSignature:
    PATH = "/webhooks/telnyx/status/"

    def _post(self, client, body, signature, timestamp):
        return client.post(
            self.PATH, body, content_type="application/json",
            HTTP_TELNYX_SIGNATURE_ED25519=signature,
            HTTP_TELNYX_TIMESTAMP=timestamp,
        )

    def test_a_valid_signature_is_accepted(self, client, webhook_settings):
        signing_key, public_b64 = telnyx_keypair()
        webhook_settings.TELNYX_PUBLIC_KEY = public_b64
        body = b'{"data": {"payload": {"call_sid": "abc"}}}'
        timestamp = str(int(time.time()))
        response = self._post(client, body,
                              telnyx_signature(signing_key, body, timestamp),
                              timestamp)
        assert response.status_code != 403

    def test_a_tampered_body_is_rejected(self, client, webhook_settings):
        signing_key, public_b64 = telnyx_keypair()
        webhook_settings.TELNYX_PUBLIC_KEY = public_b64
        timestamp = str(int(time.time()))
        signature = telnyx_signature(signing_key, b'{"amount": 1}', timestamp)
        response = self._post(client, b'{"amount": 1000}', signature, timestamp)
        assert response.status_code == 403

    def test_a_stale_timestamp_is_rejected(self, client, webhook_settings):
        """A valid signature on an old body is a replay, not an authorisation."""
        signing_key, public_b64 = telnyx_keypair()
        webhook_settings.TELNYX_PUBLIC_KEY = public_b64
        webhook_settings.WEBHOOK_MAX_SKEW_SECONDS = 300
        body = b'{"data": {}}'
        stale = str(int(time.time()) - 3600)
        response = self._post(client, body,
                              telnyx_signature(signing_key, body, stale), stale)
        assert response.status_code == 403

    def test_a_signature_from_another_key_is_rejected(self, client,
                                                      webhook_settings):
        _valid_key, public_b64 = telnyx_keypair()
        attacker_key, _ = telnyx_keypair()
        webhook_settings.TELNYX_PUBLIC_KEY = public_b64
        body = b'{"data": {}}'
        timestamp = str(int(time.time()))
        response = self._post(client, body,
                              telnyx_signature(attacker_key, body, timestamp),
                              timestamp)
        assert response.status_code == 403


# ---------------------------------------------------------------------------
# A call in flight, for the behavioural tests below.
# ---------------------------------------------------------------------------
OPT_OUT_FLOW = {
    "schema_version": "1.0",
    "entry": "menu",
    "default_locale": "en",
    "locales": ["en"],
    "nodes": {
        "menu": {
            "type": "menu",
            "prompt": {"kind": "tts", "text": "Press 9 to opt out."},
            "options": {"1": "confirm", "9": "optout"},
            "timeout_seconds": 5,
            "max_attempts": 2,
            "on_timeout": "goodbye",
            "on_invalid": "goodbye",
        },
        "confirm": {"type": "play", "prompt": {"kind": "tts", "text": "Thanks."},
                    "next": "goodbye", "disposition": "confirmed"},
        "optout": {
            "type": "opt_out",
            "prompt": {"kind": "tts", "text": "You will not be called again."},
            "scope": "organization",
        },
        "goodbye": {"type": "hangup", "prompt": {"kind": "tts", "text": "Bye."}},
    },
}


@pytest.fixture
def live_call(db, redis_client, webhook_settings):
    """A campaign, a contact and live Redis call state, as mid-call."""
    from apps.accounts.models import Organization
    from apps.campaigns.models import CallerID, Campaign
    from apps.common.utils import phone_hash
    from apps.contacts.models import Contact, ContactList
    from apps.ivr import state as call_state
    from apps.ivr.models import IVRFlow, IVRFlowVersion

    org = Organization.objects.create(name="Acme", slug="acme-webhook")
    flow = IVRFlow.objects.create(organization=org, name="Opt-out flow")
    version = IVRFlowVersion.objects.create(
        organization=org, flow=flow, version=1, is_published=True,
        definition=OPT_OUT_FLOW, entry_node="menu",
    )
    campaign = Campaign.objects.create(
        organization=org, name="C", flow_version=version,
        caller_id=CallerID.objects.create(
            organization=org, phone_e164="+15005550006", provider="twilio"
        ),
    )
    contact_list = ContactList.objects.create(organization=org, name="L")
    number = "+12125550123"
    contact = Contact.objects.create(
        organization=org, contact_list=contact_list,
        phone_e164=number, phone_hash=phone_hash(number),
    )
    # Campaigns require consent by default, and the pre-dial gate refuses
    # without it. Grant it so that these tests fail on the suppression path
    # under test rather than on a missing consent record.
    from django.utils import timezone

    from apps.contacts.models import ConsentRecord

    ConsentRecord.objects.create(
        organization=org, phone_e164=number, phone_hash=phone_hash(number),
        consent_type="express_written", scope=campaign.consent_scope,
        source="import", captured_at=timezone.now(),
    )

    sid = "CA" + uuid.uuid4().hex
    state = call_state.create(
        sid,
        organization_id=str(org.pk),
        campaign_id=str(campaign.pk),
        contact_id=str(contact.pk),
        flow_version_id=str(version.pk),
        to_number=number,
        node="menu",
    )
    return {
        "org": org, "campaign": campaign, "contact": contact,
        "version": version, "sid": sid, "state": state, "number": number,
    }


# ---------------------------------------------------------------------------
# Opt-out — the control with the most expensive failure mode.
# ---------------------------------------------------------------------------
class TestOptOut:
    """"Press 9 in the IVR: DNCEntry must exist *before* the call ends."

    The README calls this the one worth doing by hand every release, because a
    caching mistake here produces no error — just a number that keeps getting
    called. It is written synchronously in the request, so it is assertable the
    moment the response comes back.
    """

    PATH = "/webhooks/twilio/ivr/gather/"

    def test_pressing_nine_suppresses_the_number_before_responding(
        self, client, live_call
    ):
        from apps.common.utils import phone_hash
        from apps.compliance.models import DNCEntry

        sid = live_call["sid"]
        params = {"CallSid": sid, "Digits": "9"}
        url = f"{BASE_URL}{self.PATH}?sid={sid}&node=menu"
        response = client.post(
            f"{self.PATH}?sid={sid}&node=menu",
            urllib.parse.urlencode(params),
            content_type="application/x-www-form-urlencoded",
            HTTP_X_TWILIO_SIGNATURE=twilio_signature(url, params),
        )

        assert response.status_code == 200, response.content
        entry = DNCEntry.objects.unscoped().filter(
            organization=live_call["org"],
            phone_hash=phone_hash(live_call["number"]),
        ).first()
        assert entry is not None, (
            "the caller was told they would not be called again, but no "
            "suppression exists"
        )

    def test_the_pre_dial_gate_then_refuses_the_number(self, client, live_call):
        """Writing the row is only half of it — the gate must also see it.

        `is_dialable` is what the dispatcher consults immediately before the
        dial, and it caches the negative result. If the opt-out does not
        invalidate that cache the number keeps being called, with no error
        anywhere to show for it.
        """
        from apps.compliance.services import is_dialable

        org, campaign, contact = (
            live_call["org"], live_call["campaign"], live_call["contact"]
        )
        # Warm the cache the way a prior dial attempt would have.
        was_dialable, _reason = is_dialable(org.pk, campaign, contact)
        assert was_dialable, "the fixture contact should start dialable"

        sid = live_call["sid"]
        params = {"CallSid": sid, "Digits": "9"}
        url = f"{BASE_URL}{self.PATH}?sid={sid}&node=menu"
        client.post(
            f"{self.PATH}?sid={sid}&node=menu",
            urllib.parse.urlencode(params),
            content_type="application/x-www-form-urlencoded",
            HTTP_X_TWILIO_SIGNATURE=twilio_signature(url, params),
        )

        contact.refresh_from_db()
        dialable, reason = is_dialable(org.pk, campaign, contact)
        assert not dialable, (
            "opt-out recorded but the pre-dial gate still reports the number "
            f"as dialable (reason={reason!r}) — a stale cache here keeps "
            "calling someone who asked to stop"
        )

    def test_an_unsigned_opt_out_is_not_recorded(self, client, live_call):
        """The whole surface is unauthenticated; the signature is the control."""
        from apps.compliance.models import DNCEntry

        sid = live_call["sid"]
        response = client.post(
            f"{self.PATH}?sid={sid}&node=menu",
            urllib.parse.urlencode({"CallSid": sid, "Digits": "9"}),
            content_type="application/x-www-form-urlencoded",
        )
        assert response.status_code == 403
        assert not DNCEntry.objects.unscoped().filter(
            organization=live_call["org"]
        ).exists()


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------
class TestStatusCallbackIdempotency:
    """"POST the same status callback twice; the second must be a no-op."""

    PATH = "/webhooks/twilio/status/"

    @pytest.fixture
    def dispatched(self, monkeypatch):
        """Capture what the view hands to the events queue.

        `ingest_status_callback` imports the task inside the function, so the
        patch has to land on the task module rather than on `events`.
        """
        from apps.telephony import tasks

        calls = []
        monkeypatch.setattr(
            tasks.apply_status_callback, "delay",
            lambda *args, **kwargs: calls.append(args),
        )
        return calls

    def test_a_repeated_callback_is_not_processed_twice(self, live_call,
                                                        dispatched):
        from apps.telephony import events

        payload = {"CallSid": live_call["sid"], "CallStatus": "completed",
                   "SequenceNumber": "3"}

        first = events.ingest_status_callback("twilio", live_call["sid"], payload)
        second = events.ingest_status_callback("twilio", live_call["sid"], payload)

        assert first is True
        assert second is False, "the duplicate was accepted a second time"
        assert len(dispatched) == 1, "the work was enqueued twice"

    def test_a_different_status_for_the_same_call_is_still_processed(
        self, live_call, dispatched
    ):
        """Dedupe must key on the transition, not the call."""
        from apps.telephony import events

        sid = live_call["sid"]
        events.ingest_status_callback(
            "twilio", sid, {"CallSid": sid, "CallStatus": "ringing"}
        )
        events.ingest_status_callback(
            "twilio", sid, {"CallSid": sid, "CallStatus": "completed"}
        )
        assert len(dispatched) == 2

    def test_a_reordered_status_does_not_move_the_call_backwards(self):
        """The third mechanism: monotonic rank catches out-of-order delivery."""
        from apps.telephony.events import is_forward_transition

        assert is_forward_transition("ringing", "in_progress")
        assert not is_forward_transition("completed", "ringing"), (
            "a late 'ringing' after 'completed' would resurrect a finished call"
        )
