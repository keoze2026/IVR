"""Telnyx recordings are copied into our own storage, so the CDR can play them."""

import pytest
import requests
from django.core.management import call_command

from apps.telephony import tasks
from apps.telephony.models import CallLog
from tests.test_quickdial_windows import quick_dial

pytestmark = pytest.mark.django_db

SIGNED = "https://storage.example.com/rec.mp3?signature=abc"


class Reply:
    def __init__(self, status=200, content=b"", json=None, content_type="audio/mpeg"):
        self.status_code, self.content, self._json = status, content, json
        self.headers = {"Content-Type": content_type}

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(str(self.status_code))


@pytest.fixture
def call(settings):
    settings.TELNYX_API_KEY = "test-key"
    settings.TELNYX_ACCOUNT_SID = "acct"
    campaign, contact = quick_dial("+254700000123")
    return CallLog.unfiltered.create(
        organization=campaign.organization, campaign=campaign, contact=contact,
        flow_version=campaign.flow_version, provider="telnyx",
        provider_call_sid="v3:abc", from_number="+12135550100",
        to_number="+254700000123",
    )


@pytest.fixture
def stored(monkeypatch):
    """What was written to object storage."""
    written = []

    class Store:
        def put_object(self, **kwargs):
            written.append(kwargs)

    monkeypatch.setattr("apps.common.storage.s3_client", lambda: Store())
    return written


def serve(monkeypatch, replies):
    """Answer each requested URL, and remember the headers sent with it."""
    asked = []

    def get(url, headers=None, timeout=None):
        asked.append((url, headers or {}))
        reply = replies[url]
        return reply.pop(0) if isinstance(reply, list) else reply

    monkeypatch.setattr(requests, "get", get)
    return asked


LISTING = "https://api.telnyx.com/v2/texml/Accounts/acct/Calls/v3:abc/Recordings.json"


def test_a_telnyx_callback_stores_the_recording(call, stored, monkeypatch):
    asked = serve(monkeypatch, {SIGNED: Reply(content=b"audio")})

    tasks.persist_recording(
        "telnyx", "v3:abc", {"RecordingUrl": SIGNED, "RecordingDuration": "12"}
    )

    call.refresh_from_db()
    assert call.recording_key == f"{call.organization_id}/{call.pk}/recording.mp3"
    assert stored[0]["Body"] == b"audio"
    assert asked == [(SIGNED, {})]  # the API key is not sent to storage


def test_an_expired_link_is_replaced_from_the_listing(call, stored, monkeypatch):
    fresh = "https://storage.example.com/new.wav"
    serve(monkeypatch, {
        SIGNED: Reply(status=403),
        LISTING: Reply(json={"recordings": [{"media_url": fresh}]}),
        fresh: Reply(content=b"wave", content_type="audio/wav"),
    })

    key = tasks.copy_telnyx_recording(call, SIGNED)

    assert key.endswith("/recording.wav")
    assert stored[0]["ContentType"] == "audio/wav"


def test_the_key_is_sent_only_to_telnyx_itself(call, stored, monkeypatch):
    own = "https://api.telnyx.com/v2/recordings/1/download"
    asked = serve(monkeypatch, {own: [Reply(status=401), Reply(content=b"audio")]})

    tasks.copy_telnyx_recording(call, own)

    assert asked[1][1] == {"Authorization": "Bearer test-key"}


def test_earlier_calls_can_be_backfilled(call, stored, monkeypatch):
    CallLog.unfiltered.filter(pk=call.pk).update(recording_url=SIGNED)
    serve(monkeypatch, {
        LISTING: Reply(json={"recordings": [{"media_url": SIGNED}]}),
        SIGNED: Reply(content=b"audio"),
    })

    call_command("copy_telnyx_recordings")

    call.refresh_from_db()
    assert call.recording_key.endswith("/recording.mp3")


def test_a_call_telnyx_has_no_recording_for_is_left_alone(call, stored, monkeypatch):
    serve(monkeypatch, {LISTING: Reply(json={"recordings": []})})

    assert tasks.copy_telnyx_recording(call) == ""
    assert stored == []
