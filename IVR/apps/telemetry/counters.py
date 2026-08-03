"""
Counter strategy (spec 10.1).

The dashboard needs per-campaign KPIs that update within a second at 20 calls
per second across dozens of concurrent campaigns. Three approaches, and why
this one:

  UPDATE campaign_stats SET answered = answered + 1
      One row per campaign, one UPDATE per event. At 20 CPS with four
      callbacks per call that is 80 writes/second all contending on the same
      row — every transaction serialises behind the last, and the row's dead
      tuples pile up faster than autovacuum clears them.

  INSERT one row per event, aggregate on read
      No contention, but the dashboard query then scans a growing table every
      time anyone looks at it.

  HINCRBY in Redis, flushed to Postgres every 5s   ← this
      Contention-free, sub-millisecond, and the durable table is written once
      per interval per campaign instead of once per event.

The trade is that Redis counters are not durable. That is acceptable for this
data and only this data: they are a *view* of the call log, not the record of
it. Anything Redis loses can be recomputed from call_logs, and the flusher
writes absolute values rather than deltas so a lost flush self-corrects on the
next one.
"""

from __future__ import annotations

import contextlib
import logging

from redis.exceptions import RedisError

from apps.common.redis_clients import Keys, counters_redis

logger = logging.getLogger("ivr.dialer")

#: Counters live a little past the longest plausible campaign so a paused
#: campaign resumed the next morning does not restart from zero mid-flight.
KPI_TTL = 7 * 24 * 3600


def incr(campaign_id, field: str, amount: int = 1) -> None:
    """Increment one KPI field. Never raises — telemetry must not break dialling."""
    if not campaign_id:
        return
    try:
        client = counters_redis()
        pipe = client.pipeline()
        pipe.hincrby(Keys.kpi(campaign_id), field, amount)
        pipe.expire(Keys.kpi(campaign_id), KPI_TTL)
        pipe.sadd(Keys.kpi_dirty(), str(campaign_id))
        pipe.execute()
    except RedisError:
        logger.warning("kpi increment failed", extra={"field": field})


def incr_dtmf(campaign_id, digits: str) -> None:
    incr(campaign_id, f"dtmf:{digits[:8]}")


def snapshot(campaign_id) -> dict[str, int]:
    """Current counter values for one campaign."""
    try:
        raw = counters_redis().hgetall(Keys.kpi(campaign_id))
    except RedisError:
        return {}
    out = {}
    for key, value in raw.items():
        try:
            out[key] = int(value)
        except (TypeError, ValueError):
            continue
    return out


def dirty_campaigns() -> list[str]:
    """Campaigns whose counters have changed since the last flush."""
    try:
        return list(counters_redis().smembers(Keys.kpi_dirty()))
    except RedisError:
        return []


def clear_dirty(campaign_id) -> None:
    with contextlib.suppress(RedisError):
        counters_redis().srem(Keys.kpi_dirty(), str(campaign_id))


def reset(campaign_id) -> None:
    with contextlib.suppress(RedisError):
        counters_redis().delete(Keys.kpi(campaign_id))


def live_channels(campaign_id) -> int:
    try:
        return int(counters_redis().zcard(Keys.live_channels_members(campaign_id)))
    except RedisError:
        return 0


def build_frame(campaign_id, stats: dict[str, int] | None = None) -> dict:
    """
    Assemble the KPI frame sent to the dashboard (spec 10.4).

    Derived rates are computed here rather than in the frontend so that every
    consumer — websocket, REST, exports — agrees on what "answer rate" means.
    """
    stats = stats if stats is not None else snapshot(campaign_id)

    dialed = stats.get("dialed", 0)
    answered = stats.get("answered", 0)
    human = stats.get("human", 0)
    machine = stats.get("machine", 0)

    dtmf = {
        key.split(":", 1)[1]: value
        for key, value in stats.items()
        if key.startswith("dtmf:")
    }
    dispositions = {
        key.split(":", 1)[1]: value
        for key, value in stats.items()
        if key.startswith("disposition:")
    }

    return {
        "campaign_id": str(campaign_id),
        "dialed": dialed,
        "answered": answered,
        "human": human,
        "machine": machine,
        "busy": stats.get("busy", 0),
        "no_answer": stats.get("no_answer", 0),
        "failed": stats.get("failed", 0),
        "completed": stats.get("completed", 0),
        "suppressed": stats.get("suppressed", 0),
        "transferred": dispositions.get("transferred", 0),
        "opted_out": dispositions.get("opted_out", 0),
        "confirmed": dispositions.get("confirmed", 0),
        "voicemail": dispositions.get("voicemail", 0),
        "duration_seconds": stats.get("duration_seconds", 0),
        "live_channels": live_channels(campaign_id),
        "dtmf": dtmf,
        "dispositions": dispositions,
        "rates": {
            "answer": round(answered / dialed, 4) if dialed else 0.0,
            "human": round(human / dialed, 4) if dialed else 0.0,
            "machine": round(machine / answered, 4) if answered else 0.0,
            "transfer": round(dispositions.get("transferred", 0) / answered, 4)
            if answered else 0.0,
            "opt_out": round(dispositions.get("opted_out", 0) / answered, 4)
            if answered else 0.0,
        },
    }
