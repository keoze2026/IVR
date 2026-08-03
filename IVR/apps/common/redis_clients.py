"""
Direct Redis clients for the paths that need raw commands rather than the
Django cache abstraction: the token bucket, the channel semaphore, live call
state and the KPI counters.

Each logical database gets its own connection pool so a stampede on one (for
example the counters during a 20 CPS burst) cannot starve another.
"""

from __future__ import annotations

import functools

import redis
from django.conf import settings


@functools.cache
def _client(db: int, decode: bool = True) -> redis.Redis:
    return redis.Redis.from_url(
        f"{settings.REDIS_URL}/{db}",
        decode_responses=decode,
        socket_timeout=2,
        socket_connect_timeout=2,
        health_check_interval=30,
        retry_on_timeout=True,
    )


def callstate_redis() -> redis.Redis:
    """db2 — live IVR call state. Volatile, TTL'd, reconstructable."""
    return _client(settings.REDIS_DB_CALLSTATE)


def counters_redis() -> redis.Redis:
    """db4 — KPI counters, token buckets, channel semaphores.

    Run this DB with ``appendfsync everysec``: losing a second of counters is
    a cosmetic dashboard blip, but losing the channel semaphore mid-campaign
    means over-dialling until the next reconciliation.
    """
    return _client(settings.REDIS_DB_COUNTERS)


def cache_redis() -> redis.Redis:
    """db1 — general cache, including the DNC negative cache."""
    return _client(settings.REDIS_DB_CACHE)


# ---------------------------------------------------------------------------
# Key naming. Centralised so that the flusher, the pacer and the consumer
# cannot drift apart.
# ---------------------------------------------------------------------------
class Keys:
    @staticmethod
    def token_bucket(campaign_id) -> str:
        return f"tb:{campaign_id}"

    @staticmethod
    def global_token_bucket(org_id) -> str:
        return f"tb:org:{org_id}"

    @staticmethod
    def live_channels(campaign_id) -> str:
        return f"live_channels:{campaign_id}"

    @staticmethod
    def live_channels_members(campaign_id) -> str:
        """Sorted set of live call SIDs, scored by dial time. Backs both the
        semaphore reconciliation and the stuck-call sweeper."""
        return f"live_calls:{campaign_id}"

    @staticmethod
    def org_live_channels(org_id) -> str:
        return f"live_channels:org:{org_id}"

    @staticmethod
    def call_state(call_sid) -> str:
        return f"call_state:{call_sid}"

    @staticmethod
    def kpi(campaign_id) -> str:
        return f"kpi:{campaign_id}"

    @staticmethod
    def kpi_dirty() -> str:
        """Set of campaign ids with counters awaiting flush."""
        return "kpi:dirty"

    @staticmethod
    def dedupe(call_sid, event_type, sequence) -> str:
        return f"dedupe:{call_sid}:{event_type}:{sequence}"

    @staticmethod
    def campaign_lock(campaign_id) -> str:
        return f"lock:pace:{campaign_id}"

    @staticmethod
    def flow_cache(flow_version_id) -> str:
        return f"flow:{flow_version_id}"

    @staticmethod
    def attempts_today(campaign_id, phone_hash, day) -> str:
        return f"attempts:{campaign_id}:{day}:{phone_hash}"

    @staticmethod
    def channel_group(campaign_id) -> str:
        return f"campaign.{campaign_id}"
