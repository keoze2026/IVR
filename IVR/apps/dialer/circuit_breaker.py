"""
Carrier Circuit Breaker & Health Manager (spec 7.6).

Tracks per-carrier failure rates, 429 rate limits, connection timeouts, and
5xx carrier outages across Celery dispatch workers using Redis.
"""

from __future__ import annotations

import contextlib
import logging
import time
from typing import Any

from django.conf import settings
from redis.exceptions import RedisError

from apps.common.redis_clients import counters_redis

logger = logging.getLogger("ivr.dialer")


class CircuitState:
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    TRIPPED = "tripped"


class CarrierCircuitBreaker:
    """
    Distributed circuit breaker tracking carrier health in Redis.

    Prevents dispatch workers from repeatedly slamming a degraded carrier with
    outbound calls, and enables transparent in-flight failover to healthy carriers.
    """

    def __init__(self, client=None):
        self._client = client

    @property
    def redis(self):
        if self._client is not None:
            return self._client
        return counters_redis()

    def _key(self, provider: str) -> str:
        return f"circuit:carrier:{provider.lower()}"

    def is_available(self, provider: str) -> bool:
        """
        Check whether the carrier is healthy to accept outbound dials.
        Returns False if the carrier is currently tripped / in cooldown.
        """
        if not getattr(settings, "ENABLE_CARRIER_FAILOVER", True):
            return True

        key = self._key(provider)
        try:
            raw = self.redis.hgetall(key)
            if not raw:
                return True

            state = raw.get("state", CircuitState.HEALTHY)
            tripped_until = float(raw.get("tripped_until", 0))
            now = time.time()

            if state == CircuitState.TRIPPED:
                return now >= tripped_until

            return True
        except (RedisError, ValueError, TypeError) as exc:
            logger.warning("circuit breaker redis read failed, failing open",
                           extra={"provider": provider, "error": str(exc)})
            return True

    def record_success(self, provider: str) -> None:
        """Record a successful call origination at the carrier."""
        key = self._key(provider)
        now = time.time()
        try:
            self.redis.hset(
                key,
                mapping={
                    "state": CircuitState.HEALTHY,
                    "consecutive_failures": 0,
                    "tripped_until": 0,
                    "last_success_at": now,
                },
            )
            self.redis.hincrby(key, "total_successes", 1)
            self.redis.hincrby(key, "total_requests", 1)
        except RedisError as exc:
            logger.warning("circuit breaker record_success failed",
                           extra={"provider": provider, "error": str(exc)})

    def record_failure(
        self,
        provider: str,
        error: Exception | str,
        *,
        is_rate_limit: bool = False,
        retry_after: float = 0.0,
        is_server_outage: bool = False,
    ) -> bool:
        """
        Record an originate failure. Trips the circuit if threshold is exceeded.
        Returns True if the circuit tripped as a result.
        """
        key = self._key(provider)
        now = time.time()
        cooldown_default = getattr(settings, "CARRIER_CIRCUIT_BREAKER_COOLDOWN", 60)
        threshold = getattr(settings, "CARRIER_CIRCUIT_BREAKER_THRESHOLD", 3)

        cooldown = max(retry_after, cooldown_default) if is_rate_limit else cooldown_default
        err_msg = str(error)[:200]

        try:
            pipe = self.redis.pipeline()
            pipe.hincrby(key, "consecutive_failures", 1)
            pipe.hincrby(key, "total_failures", 1)
            pipe.hincrby(key, "total_requests", 1)
            pipe.hset(
                key,
                mapping={
                    "last_failure_at": now,
                    "last_error": err_msg,
                },
            )
            results = pipe.execute()
            failures = results[0]

            should_trip = is_rate_limit or is_server_outage or failures >= threshold
            if should_trip:
                tripped_until = now + cooldown
                self.redis.hset(
                    key,
                    mapping={
                        "state": CircuitState.TRIPPED,
                        "tripped_until": tripped_until,
                    },
                )
                logger.error(
                    "carrier circuit TRIPPED",
                    extra={
                        "provider": provider,
                        "cooldown_seconds": cooldown,
                        "consecutive_failures": failures,
                        "reason": err_msg,
                    },
                )
                return True

            return False
        except RedisError as exc:
            logger.warning("circuit breaker record_failure failed",
                           extra={"provider": provider, "error": str(exc)})
            return False

    def record_failover(self, from_provider: str, to_provider: str) -> None:
        """Increment failover counters for telemetry and observability."""
        with contextlib.suppress(RedisError):
            self.redis.hincrby(self._key(from_provider), "total_failovers_from", 1)
            self.redis.hincrby(self._key(to_provider), "total_failovers_to", 1)

    def get_carrier_health(self, provider: str) -> dict[str, Any]:
        """Return formatted health dictionary for a given provider."""
        key = self._key(provider)
        now = time.time()
        try:
            raw = self.redis.hgetall(key)
        except RedisError:
            raw = {}

        state = raw.get("state", CircuitState.HEALTHY)
        tripped_until = float(raw.get("tripped_until", 0))
        is_available = self.is_available(provider)
        cooldown_left = (
            max(0, int(tripped_until - now)) if state == CircuitState.TRIPPED else 0
        )
        raw_succ = raw.get("last_success_at")
        last_succ = float(raw_succ) if raw_succ else None
        raw_fail = raw.get("last_failure_at")
        last_fail = float(raw_fail) if raw_fail else None

        return {
            "provider": provider,
            "state": state,
            "is_available": is_available,
            "consecutive_failures": int(raw.get("consecutive_failures", 0)),
            "tripped_until": tripped_until if tripped_until > now else None,
            "cooldown_remaining_seconds": cooldown_left,
            "last_error": raw.get("last_error") or None,
            "last_success_at": last_succ,
            "last_failure_at": last_fail,
            "total_requests": int(raw.get("total_requests", 0)),
            "total_successes": int(raw.get("total_successes", 0)),
            "total_failures": int(raw.get("total_failures", 0)),
            "total_failovers": int(raw.get("total_failovers_from", 0)),
        }

    def get_all_health(self, providers: list[str] | None = None) -> list[dict[str, Any]]:
        """Return health status list for all known carriers."""
        target_providers = providers or ["twilio", "telnyx"]
        return [self.get_carrier_health(p) for p in target_providers]

    def reset(self, provider: str) -> None:
        """Manually clear circuit breaker state for a carrier."""
        with contextlib.suppress(RedisError):
            self.redis.delete(self._key(provider))


circuit_breaker = CarrierCircuitBreaker()
