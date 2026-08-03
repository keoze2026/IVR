"""
Shared fixtures.

Redis is used for real, not mocked. The token bucket and the channel semaphore
are Lua scripts executed server-side, and a mock that returns whatever the test
expects would prove nothing about them. Tests run against a dedicated logical
database (15) which is flushed around each test.

If no Redis is reachable the affected tests skip rather than fail, so the pure
logic suite (windows, DSL validator, runtime, ingest) still runs anywhere.
"""

import datetime as dt

import pytest

#: Logical DB reserved for tests. Never the ones the application uses.
TEST_REDIS_DB = 15

#: Modules that did `from apps.common.redis_clients import counters_redis`.
#: They hold their own reference to the function, so patching the source
#: module alone would have no effect on them.
_COUNTER_CONSUMERS = (
    "apps.dialer.limits",
    "apps.telephony.events",
    "apps.telemetry.counters",
)
_CALLSTATE_CONSUMERS = ("apps.ivr.state",)


@pytest.fixture
def redis_client(monkeypatch):
    """A real Redis connection on a throwaway DB, injected everywhere."""
    import importlib

    import redis as redis_lib
    from django.conf import settings

    client = redis_lib.Redis.from_url(
        f"{settings.REDIS_URL}/{TEST_REDIS_DB}",
        decode_responses=True,
        socket_connect_timeout=1,
        socket_timeout=1,
    )
    try:
        client.ping()
    except redis_lib.RedisError:
        pytest.skip("no Redis reachable on REDIS_URL; skipping Redis-backed tests")

    client.flushdb()

    from apps.common import redis_clients

    for attr in ("counters_redis", "callstate_redis", "cache_redis"):
        monkeypatch.setattr(redis_clients, attr, lambda c=client: c)
    for module_path in _COUNTER_CONSUMERS:
        monkeypatch.setattr(
            importlib.import_module(module_path), "counters_redis", lambda c=client: c
        )
    for module_path in _CALLSTATE_CONSUMERS:
        monkeypatch.setattr(
            importlib.import_module(module_path), "callstate_redis", lambda c=client: c
        )

    yield client

    client.flushdb()
    client.close()


#: Kept as an alias so tests read naturally either way.
@pytest.fixture
def fake_redis(redis_client):
    return redis_client


@pytest.fixture
def organization(db):
    from apps.accounts.models import Organization

    return Organization.objects.create(
        name="Acme", slug="acme", max_cps=10.0, max_concurrent_channels=100
    )


@pytest.fixture
def flow_definition():
    return {
        "schema_version": "1.0",
        "entry": "greeting",
        "default_locale": "en",
        "locales": ["en"],
        "nodes": {
            "greeting": {
                "type": "play",
                "prompt": {"kind": "tts", "text": "Hello."},
                "next": "menu",
            },
            "menu": {
                "type": "menu",
                "prompt": {"kind": "tts", "text": "Press 1 to confirm, 9 to stop."},
                "options": {"1": "confirm", "9": "optout"},
                "timeout_seconds": 5,
                "max_attempts": 2,
                "on_timeout": "goodbye",
                "on_invalid": "goodbye",
            },
            "confirm": {
                "type": "play",
                "prompt": {"kind": "tts", "text": "Thank you."},
                "next": "goodbye",
                "disposition": "confirmed",
            },
            "optout": {
                "type": "opt_out",
                "prompt": {"kind": "tts", "text": "You will not be called again."},
                "scope": "organization",
            },
            "goodbye": {
                "type": "hangup",
                "prompt": {"kind": "tts", "text": "Goodbye."},
            },
        },
    }


@pytest.fixture
def flow(flow_definition):
    """A loaded flow document in the shape runtime.load_flow returns."""
    return {
        "definition": flow_definition,
        "entry": flow_definition["entry"],
        "rendered_prompts": {},
    }


class FakeCampaign:
    """Minimal duck type for the window resolver, which needs no database."""

    def __init__(self, **kwargs):
        self.organization_id = kwargs.get("organization_id", "org-1")
        self.respect_contact_timezone = kwargs.get("respect_contact_timezone", True)
        self.fallback_timezone = kwargs.get("fallback_timezone", "UTC")
        self.window_start_local = kwargs.get("window_start_local", dt.time(9, 0))
        self.window_end_local = kwargs.get("window_end_local", dt.time(17, 0))
        self.active_weekdays = kwargs.get("active_weekdays", [0, 1, 2, 3, 4])


class FakeContact:
    def __init__(self, **kwargs):
        self.phone_e164 = kwargs.get("phone_e164", "+12125550123")
        self.country_code = kwargs.get("country_code", "1")
        self.timezone = kwargs.get("timezone", "America/New_York")
        self.phone_hash = kwargs.get("phone_hash", "deadbeef")
        self.variables = kwargs.get("variables", {})


@pytest.fixture
def fake_campaign():
    return FakeCampaign


@pytest.fixture
def fake_contact():
    return FakeContact
