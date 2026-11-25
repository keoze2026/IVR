"""
Tests for Multi-Carrier Dynamic Routing, Circuit Breaker & Failover.
"""

from unittest.mock import MagicMock

import pytest

from apps.dialer.circuit_breaker import CarrierCircuitBreaker, CircuitState
from apps.dialer.providers.base import (
    CallHandle,
    OriginateRequest,
    ProviderAdapter,
    ProviderCallError,
    ProviderRateLimited,
)
from apps.dialer.routing import (
    is_failover_eligible,
    originate_with_failover,
)


class FakeRedis:
    """In-memory Redis fake for testing distributed circuit breaker."""

    def __init__(self):
        self.hashes = {}

    def hgetall(self, key):
        return self.hashes.get(key, {})

    def hset(self, key, mapping=None, **kwargs):
        if key not in self.hashes:
            self.hashes[key] = {}
        if mapping:
            self.hashes[key].update({k: str(v) for k, v in mapping.items()})
        if kwargs:
            self.hashes[key].update({k: str(v) for k, v in kwargs.items()})
        return len(mapping or kwargs)

    def hincrby(self, key, field, amount=1):
        if key not in self.hashes:
            self.hashes[key] = {}
        val = int(self.hashes[key].get(field, 0)) + amount
        self.hashes[key][field] = str(val)
        return val

    def delete(self, *keys):
        for k in keys:
            self.hashes.pop(k, None)

    def pipeline(self):
        return FakePipeline(self)


class FakePipeline:
    def __init__(self, redis):
        self.redis = redis
        self.ops = []

    def hincrby(self, key, field, amount=1):
        self.ops.append(lambda: self.redis.hincrby(key, field, amount))
        return self

    def hset(self, key, mapping=None):
        self.ops.append(lambda: self.redis.hset(key, mapping=mapping))
        return self

    def execute(self):
        results = [op() for op in self.ops]
        self.ops = []
        return results


class FakeCarrier(ProviderAdapter):
    def __init__(self, name="twilio", fail_with=None, sid="CA-fake"):
        self.name = name
        self.fail_with = fail_with
        self.sid = sid
        self.placed_requests = []

    def place_call(self, request: OriginateRequest) -> CallHandle:
        self.placed_requests.append(request)
        if self.fail_with:
            raise self.fail_with
        return CallHandle(sid=self.sid, status="queued")

    def normalise_status(self, status):
        from apps.common.enums import CallStatus
        return CallStatus.QUEUED


# --- Circuit Breaker Tests --------------------------------------------------

def test_circuit_breaker_transitions(settings):
    settings.CARRIER_CIRCUIT_BREAKER_THRESHOLD = 3
    settings.CARRIER_CIRCUIT_BREAKER_COOLDOWN = 10

    fake_redis = FakeRedis()
    cb = CarrierCircuitBreaker(client=fake_redis)

    assert cb.is_available("twilio") is True

    # First and second failures do not trip
    assert cb.record_failure("twilio", "timeout 1") is False
    assert cb.is_available("twilio") is True
    assert cb.record_failure("twilio", "timeout 2") is False
    assert cb.is_available("twilio") is True

    # Third failure reaches threshold and trips
    assert cb.record_failure("twilio", "timeout 3") is True
    assert cb.is_available("twilio") is False

    health = cb.get_carrier_health("twilio")
    assert health["state"] == CircuitState.TRIPPED
    assert health["consecutive_failures"] == 3
    assert health["is_available"] is False

    # Success clears failures and recovers circuit
    cb.record_success("twilio")
    assert cb.is_available("twilio") is True
    health = cb.get_carrier_health("twilio")
    assert health["state"] == CircuitState.HEALTHY
    assert health["consecutive_failures"] == 0


def test_circuit_breaker_rate_limit_trips_immediately(settings):
    fake_redis = FakeRedis()
    cb = CarrierCircuitBreaker(client=fake_redis)

    tripped = cb.record_failure(
        "twilio", "Rate limit 429", is_rate_limit=True, retry_after=30
    )
    assert tripped is True
    assert cb.is_available("twilio") is False


# --- Failover Eligibility Tests ---------------------------------------------

def test_failover_eligibility():
    # 5xx server errors and rate limits are eligible
    assert is_failover_eligible(ProviderRateLimited("429 Too Many Requests")) is True
    err_503 = ProviderCallError("Service Unavailable", status=503)
    assert is_failover_eligible(err_503) is True
    assert is_failover_eligible(ProviderCallError("Internal Error", status=500)) is True
    assert is_failover_eligible(Exception("Connection timeout")) is True

    # Permanent recipient / validation errors are NOT eligible
    assert is_failover_eligible(ProviderCallError("Invalid Number", code="21217")) is False
    err_geo = ProviderCallError("Geo permission not enabled", code="21215")
    assert is_failover_eligible(err_geo) is False
    assert is_failover_eligible(ProviderCallError("Opted out", code="21610")) is False


# --- Multi-Carrier In-Flight Failover Tests -----------------------------------

def make_fake_campaign_objects():
    campaign = MagicMock()
    campaign.pk = "cmp_123"
    campaign.name = "Failover Campaign"
    campaign.effective_provider = "twilio"
    campaign.caller_id.phone_e164 = "+12125550100"
    campaign.caller_id.cnam_display = "Verified"
    campaign.ring_timeout_seconds = 30
    campaign.amd_enabled = True
    campaign.amd_mode = "DetectMessageEnd"
    campaign.amd_async = True
    campaign.amd_timeout_seconds = 30
    campaign.record_calls = False

    contact = MagicMock()
    contact.pk = "cnt_456"
    contact.phone_e164 = "+12125550199"

    call = MagicMock()
    call.pk = "call_789"
    call.provider = "twilio"

    row = MagicMock()
    row.pk = "row_001"
    row.campaign = campaign
    row.contact = contact
    row.attempts = 0

    return campaign, contact, call, row


def test_originate_with_transparent_failover(monkeypatch, settings):
    """When Twilio fails with 503, automatically routes to Telnyx."""
    campaign, contact, call, row = make_fake_campaign_objects()

    fake_twilio = FakeCarrier(
        name="twilio",
        fail_with=ProviderCallError("Twilio Outage 503", status=503, retryable=True),
    )
    fake_telnyx = FakeCarrier(name="telnyx", sid="TELNYX-SUCCESS-SID")

    def fake_get_provider(name):
        if name == "twilio":
            return fake_twilio
        if name == "telnyx":
            return fake_telnyx
        raise ValueError(f"Unknown {name}")

    monkeypatch.setattr("apps.dialer.routing.get_provider", fake_get_provider)

    handle, active_provider, provider = originate_with_failover(
        campaign, contact, call, row
    )

    # Verified failover result
    assert handle.sid == "TELNYX-SUCCESS-SID"
    assert active_provider == "telnyx"
    assert len(fake_twilio.placed_requests) == 1
    assert len(fake_telnyx.placed_requests) == 1

    # Verified webhook URL re-writing
    telnyx_req = fake_telnyx.placed_requests[0]
    assert "/webhooks/telnyx/ivr/entry/" in telnyx_req.answer_url
    assert "/webhooks/telnyx/status/" in telnyx_req.status_callback_url

    # Verified CallLog provider updated
    assert call.provider == "telnyx"


def test_permanent_error_does_not_failover(monkeypatch):
    """Invalid destination numbers fail immediately without spamming fallback carriers."""
    campaign, contact, call, row = make_fake_campaign_objects()

    fake_twilio = FakeCarrier(
        name="twilio",
        fail_with=ProviderCallError("Number unroutable", code="21217"),
    )
    fake_telnyx = FakeCarrier(name="telnyx")

    def fake_get_provider(name):
        if name == "twilio":
            return fake_twilio
        return fake_telnyx

    monkeypatch.setattr("apps.dialer.routing.get_provider", fake_get_provider)

    with pytest.raises(ProviderCallError) as exc_info:
        originate_with_failover(campaign, contact, call, row)

    assert exc_info.value.code == "21217"
    assert len(fake_twilio.placed_requests) == 1
    assert len(fake_telnyx.placed_requests) == 0  # Telnyx never called


def test_toll_free_never_routes_to_twilio(settings):
    from types import SimpleNamespace

    from apps.dialer.routing import is_toll_free, resolve_carrier_chain

    settings.TOLL_FREE_PROVIDER = "telnyx"
    campaign = SimpleNamespace(effective_provider="twilio")
    assert is_toll_free("+18005551234") and is_toll_free("+18885551234")
    assert not is_toll_free("+12125551234")
    assert resolve_carrier_chain(campaign, "+18005551234") == ["telnyx"]
    assert resolve_carrier_chain(campaign, "+12125551234")[0] in {"twilio", "telnyx"}


def test_telnyx_machine_detection_timeout_is_sent_in_milliseconds(monkeypatch):
    from apps.dialer.providers.base import OriginateRequest
    from apps.dialer.providers.telnyx import TelnyxAdapter

    sent = {}
    monkeypatch.setattr(
        TelnyxAdapter, "_post", lambda self, url, data, **kw: sent.update(data) or {}
    )
    TelnyxAdapter().place_call(OriginateRequest(
        to="+18005551234", from_="+12125550100", answer_url="https://x.invalid/a",
        status_callback_url="https://x.invalid/s", amd_enabled=True, amd_timeout=30,
    ))
    assert sent["MachineDetectionTimeout"] == 30000
