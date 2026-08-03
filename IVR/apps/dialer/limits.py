"""
The two independent limits (spec 7.1) and why Celery's rate_limit is not one
of them (spec 7.2).

There are two distinct constraints on outbound dialling and they fail in
different ways:

  CPS (calls per second)
      A *rate*. Exceed it and the carrier returns 429s and, sustained,
      throttles or suspends the account. It is a property of the carrier
      account, shared by every worker.

  Concurrent channels
      A *level*. Exceed it and calls fail to originate, or — worse on a
      predictive-style campaign — you connect more humans than you can
      handle. Also account-wide.

They are independent: 1 CPS with 30-minute calls saturates 30 channels within
half an hour; 20 CPS with 10-second calls never exceeds 200. A dialer that
controls only one of them will eventually breach the other.

Why not Celery's rate_limit
---------------------------
``@shared_task(rate_limit="10/s")`` is enforced *per worker process*. Ten
workers means 100/s at the carrier. Autoscale to thirty and you are at 300/s
without changing a line of configuration. It also cannot express "not more than
N in flight", because it knows when a task starts and not when the resulting
call ends. Both limits therefore live in Redis, shared by every process, and
the pacer is the only component that consults them.

Failure posture
---------------
If Redis is unreachable, both primitives deny. A dialer that keeps dialling
when it cannot verify its own limits is exactly the failure mode the whole
design exists to prevent.
"""

from __future__ import annotations

import contextlib
import logging

from redis.exceptions import RedisError

from apps.common.redis_clients import Keys, counters_redis

logger = logging.getLogger("ivr.dialer")


# ---------------------------------------------------------------------------
# Token bucket
#
# Server-side clock (redis TIME) rather than a client timestamp: beat ticks
# arrive from whichever scheduler host is alive, and a few hundred milliseconds
# of clock skew between hosts turns into a burst above the configured CPS.
# ---------------------------------------------------------------------------
_TOKEN_BUCKET_LUA = """
local key       = KEYS[1]
local rate      = tonumber(ARGV[1])
local capacity  = tonumber(ARGV[2])
local requested = tonumber(ARGV[3])
local ttl       = tonumber(ARGV[4])

local t = redis.call('TIME')
local now = tonumber(t[1]) + (tonumber(t[2]) / 1000000)

local bucket = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts     = tonumber(bucket[2])

if tokens == nil or ts == nil then
    tokens = capacity
    ts = now
end

local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end
tokens = math.min(capacity, tokens + (elapsed * rate))

local granted = math.floor(math.min(tokens, requested))
if granted < 0 then granted = 0 end
tokens = tokens - granted

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, ttl)
return granted
"""


class TokenBucket:
    """Global CPS limiter, one bucket per campaign plus one per organisation."""

    def __init__(self, key: str, rate: float, capacity: float | None = None):
        self.key = key
        self.rate = max(0.0, float(rate))
        # A one-second burst allowance. Larger and a campaign that has been
        # paused for an hour would dump its accumulated tokens at the carrier
        # in a single tick.
        self.capacity = capacity if capacity is not None else max(1.0, self.rate)

    def take(self, n: int = 1) -> int:
        """Consume up to n tokens; return how many were actually granted."""
        if n <= 0 or self.rate <= 0:
            return 0
        try:
            client = counters_redis()
            script = client.register_script(_TOKEN_BUCKET_LUA)
            granted = script(
                keys=[self.key],
                args=[self.rate, self.capacity, n, 3600],
            )
            return int(granted)
        except RedisError:
            logger.exception("token bucket unavailable; denying", extra={"key": self.key})
            return 0

    def peek(self) -> float:
        try:
            value = counters_redis().hget(self.key, "tokens")
            return float(value) if value is not None else self.capacity
        except (RedisError, TypeError, ValueError):
            return 0.0

    def reset(self):
        try:
            counters_redis().delete(self.key)
        except RedisError:  # pragma: no cover
            logger.exception("failed to reset token bucket")


def campaign_bucket(campaign) -> TokenBucket:
    return TokenBucket(Keys.token_bucket(campaign.pk), campaign.effective_cps())


def org_bucket(organization) -> TokenBucket:
    return TokenBucket(Keys.global_token_bucket(organization.pk),
                       float(organization.max_cps))


# ---------------------------------------------------------------------------
# Channel semaphore
#
# Backed by a sorted set of live call SIDs scored by dial time rather than a
# bare INCR/DECR counter. A counter drifts: every lost "completed" callback
# leaks a channel permanently, and after a day of leaks a campaign configured
# for 30 channels is dialling 4. The sorted set is self-healing — expired
# members are trimmed on every acquire, and membership is reconstructable from
# CallLog.
# ---------------------------------------------------------------------------
_ACQUIRE_LUA = """
local key      = KEYS[1]
local limit    = tonumber(ARGV[1])
local member   = ARGV[2]
local max_age  = tonumber(ARGV[3])
local ttl      = tonumber(ARGV[4])

local t = redis.call('TIME')
local now = tonumber(t[1])

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - max_age)

local live = redis.call('ZCARD', key)
if live >= limit then
    return -1
end

redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttl)
return limit - live - 1
"""


class ChannelSemaphore:
    """Ceiling on simultaneously live calls for one campaign."""

    #: No legitimate outbound IVR call lasts this long. Anything still in the
    #: set after it is a lost callback, not a conversation.
    MAX_CALL_AGE_SECONDS = 4 * 3600

    def __init__(self, campaign_id, limit: int):
        self.key = Keys.live_channels_members(campaign_id)
        self.limit = int(limit)

    def acquire(self, member: str) -> bool:
        """Reserve a channel for `member` (the CampaignContact or call id)."""
        try:
            client = counters_redis()
            script = client.register_script(_ACQUIRE_LUA)
            result = int(
                script(
                    keys=[self.key],
                    args=[self.limit, member, self.MAX_CALL_AGE_SECONDS,
                          self.MAX_CALL_AGE_SECONDS],
                )
            )
            return result >= 0
        except RedisError:
            logger.exception("channel semaphore unavailable; denying")
            return False

    def release(self, member: str) -> None:
        try:
            counters_redis().zrem(self.key, member)
        except RedisError:  # pragma: no cover
            logger.exception("failed to release channel")

    def rename(self, old_member: str, new_member: str) -> None:
        """
        Re-key a reservation once the carrier has issued a call SID.

        The channel is reserved before the call is placed (using the queue row
        id) so that concurrency is respected even during the carrier round
        trip; once the SID exists, the reservation is re-keyed so the status
        callback can release it.
        """
        try:
            client = counters_redis()
            score = client.zscore(self.key, old_member)
            if score is None:
                return
            pipe = client.pipeline()
            pipe.zrem(self.key, old_member)
            pipe.zadd(self.key, {new_member: score})
            pipe.execute()
        except RedisError:  # pragma: no cover
            logger.exception("failed to rename channel reservation")

    def live(self) -> int:
        try:
            return int(counters_redis().zcard(self.key))
        except RedisError:
            # Reported as saturated so the pacer stops rather than guesses.
            return self.limit

    def available(self) -> int:
        return max(0, self.limit - self.live())

    def members(self) -> list[str]:
        try:
            return list(counters_redis().zrange(self.key, 0, -1))
        except RedisError:
            return []

    def reconcile(self, live_members: set[str]) -> int:
        """
        Replace the set with ground truth from Postgres.

        Run periodically (spec: dialer.reconcile_live_channels). Returns the
        number of leaked entries removed.
        """
        try:
            client = counters_redis()
            current = set(client.zrange(self.key, 0, -1))
            leaked = current - live_members
            if leaked:
                client.zrem(self.key, *leaked)
            missing = live_members - current
            if missing:
                import time

                now = int(time.time())
                client.zadd(self.key, {m: now for m in missing})
            return len(leaked)
        except RedisError:  # pragma: no cover
            logger.exception("channel reconciliation failed")
            return 0

    def clear(self):
        with contextlib.suppress(RedisError):
            counters_redis().delete(self.key)


def campaign_semaphore(campaign) -> ChannelSemaphore:
    return ChannelSemaphore(campaign.pk, campaign.effective_channels())
